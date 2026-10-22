import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "@nightshift/db";
import { session, user } from "@nightshift/db/schema";

import { testDatabase } from "../testing";
import { createTargetStore, registerScreenSchema, targetView } from "./targets";

let db: Database;
let cleanup: () => void;
beforeEach(async () => {
	({ db, cleanup } = await testDatabase());
});
afterEach(() => cleanup());

test("a screen registers once per endpoint; registering again renames it and marks it seen", async () => {
	let clock = 1_000;
	const store = createTargetStore(db, () => clock);
	const first = await store.register(
		"ada",
		{
			kind: "web",
			name: "Safari",
			endpoint: "https://push.example/abc",
			keys: { p256dh: "key", auth: "secret" },
		},
		"session-1",
	);
	clock = 2_000;
	const again = await store.register("ada", {
		kind: "web",
		name: "Safari on MacBook",
		endpoint: "https://push.example/abc",
		keys: { p256dh: "key", auth: "secret" },
	});

	expect(again.id).toBe(first.id);
	expect(again).toMatchObject({
		name: "Safari on MacBook",
		createdAt: 1_000,
		lastSeenAt: 2_000,
		keys: { p256dh: "key", auth: "secret" },
	});
	expect(await store.of("ada")).toHaveLength(1);
	expect(targetView(again)).toEqual({
		id: first.id,
		kind: "web",
		name: "Safari on MacBook",
		platform: "",
		createdAt: 1_000,
		lastSeenAt: 2_000,
	});
});

test("a Person removes only their own screens", async () => {
	const store = createTargetStore(db);
	const phone = await store.register("ada", {
		kind: "expo",
		name: "Pixel",
		platform: "android",
		endpoint: "ExponentPushToken[abc]",
	});

	expect(await store.remove("bob", phone.id)).toBe(null);
	expect(await store.of("ada")).toHaveLength(1);
	expect((await store.remove("ada", phone.id))?.id).toBe(phone.id);
	expect(await store.of("ada")).toEqual([]);
});

describe("a phone", () => {
	/** A Person with these sessions, each ending at its time (ms). */
	async function personWith(id: string, sessions: Record<string, number>) {
		await db.insert(user).values({ id, name: id, email: `${id}@example.com` });
		for (const [sessionId, endsAt] of Object.entries(sessions)) {
			await db.insert(session).values({
				id: sessionId,
				token: `token-${sessionId}`,
				userId: id,
				expiresAt: new Date(endsAt),
				updatedAt: new Date(0),
			});
		}
	}
	const phone = (endpoint = "ExponentPushToken[shared]") => ({
		kind: "expo" as const,
		name: "Team phone",
		endpoint,
	});

	test("gets nothing more once its session ended: signed out, expired or revoked", async () => {
		const store = createTargetStore(db, () => 5_000);
		await personWith("ada", { live: 10_000, expired: 4_000 });
		const kept = await store.register(
			"ada",
			phone("ExponentPushToken[a]"),
			"live",
		);
		const expired = await store.register(
			"ada",
			phone("ExponentPushToken[b]"),
			"expired",
		);
		const signedOut = await store.register(
			"ada",
			phone("ExponentPushToken[c]"),
			"signed-out",
		);
		// A browser's target does not end with its session.
		const browser = await store.register(
			"ada",
			{
				kind: "web",
				name: "Safari",
				endpoint: "https://web.push.apple.com/abc",
			},
			"signed-out",
		);

		expect((await store.of("ada")).map((t) => t.id)).toEqual([
			kept.id,
			browser.id,
		]);
		// Forgotten, not only left out.
		expect(await store.byIds([expired.id, signedOut.id])).toEqual([]);
	});

	test("reaches only the Person who signed in on it last", async () => {
		const store = createTargetStore(db, () => 5_000);
		await personWith("ada", { "ada-phone": 10_000 });
		await personWith("bob", { "bob-phone": 10_000 });
		await store.register("ada", phone(), "ada-phone");
		// Ada signed out while the phone was offline; Bob signs in on it.
		const bobs = await store.register("bob", phone(), "bob-phone");

		expect(await store.of("ada")).toEqual([]);
		expect((await store.of("bob")).map((t) => t.id)).toEqual([bobs.id]);
	});
});

describe("a screen that registers itself", () => {
	const accepts = (screen: Record<string, unknown>) =>
		registerScreenSchema.safeParse({ name: "Screen", ...screen }).success;
	const keys = { p256dh: "key", auth: "secret" };

	test("is a browser on a known push service", () => {
		for (const endpoint of [
			"https://fcm.googleapis.com/fcm/send/abc",
			"https://updates.push.services.mozilla.com/wpush/v2/abc",
			"https://web.push.apple.com/abc",
			"https://wns2-par02p.notify.windows.com/w/?token=abc",
		]) {
			expect(accepts({ kind: "web", endpoint, keys })).toBe(true);
		}
	});

	test("never makes the Host call another address", () => {
		for (const endpoint of [
			"https://10.0.0.5:8443/admin/reset",
			"https://127.0.0.1/",
			"https://169.254.169.254/latest/meta-data",
			"http://fcm.googleapis.com/fcm/send/abc",
			"https://fcm.googleapis.com:8443/fcm/send/abc",
			"https://user@fcm.googleapis.com/fcm/send/abc",
			"https://fcm.googleapis.com.evil.example/abc",
			"https://evilfcm.googleapis.com.example/abc",
			"https://push.example/abc",
			"not a url",
		]) {
			expect(accepts({ kind: "web", endpoint, keys })).toBe(false);
		}
	});

	test("is a phone with an Expo push token", () => {
		expect(
			accepts({ kind: "expo", endpoint: "ExponentPushToken[abc123]" }),
		).toBe(true);
		expect(accepts({ kind: "expo", endpoint: "https://10.0.0.5/" })).toBe(
			false,
		);
	});

	test("is never this computer's desktop", () => {
		expect(accepts({ kind: "desktop", endpoint: "device-1" })).toBe(false);
	});
});
