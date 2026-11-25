import { beforeEach, describe, expect, test } from "bun:test";
import { migratedDb } from "@nightshift/db/testing";
import { Expo } from "expo-server-sdk";
import type { PushKind } from "../../../../channels";
import type { TargetStore } from "../../application/ports";
import type { NewTarget } from "../../domain/push-targets";
import { isExpoPushToken, type TARGET_KINDS } from "../../domain/push-targets";
import { drizzleTargetStore } from "./drizzle-target-store";

const target = (
	id: string,
	personId: string,
	fields: Partial<NewTarget> = {},
): NewTarget => ({
	id,
	personId,
	kind: "web",
	name: "Safari",
	platform: "",
	endpoint: `https://web.push.apple.com/${id}`,
	keys: { p256dh: "key", auth: "secret" },
	sessionId: null,
	at: 1_000,
	...fields,
});

/** `true` when each type is assignable to the other, else `false`. */
type SameKinds<A, B> = [A] extends [B]
	? [B] extends [A]
		? true
		: false
	: false;

describe("what the targets restate", () => {
	test("the kinds of push target are the channels' kinds", () => {
		// The type check fails here when the two lists differ.
		const same: SameKinds<PushKind, (typeof TARGET_KINDS)[number]> = true;
		expect(same).toBe(true);
	});

	test("the Expo push token test is the SDK's", () => {
		for (const token of [
			"ExponentPushToken[abc123]",
			"ExpoPushToken[abc]",
			"ExponentPushToken[",
			"ExponentPushToken[abc",
			"xExponentPushToken[abc]",
			"12345678-abcd-ABCD-1234-1234567890ab",
			"12345678-abcd-abcd-1234-1234567890a",
			"https://10.0.0.5/",
			"",
			42,
			null,
		]) {
			expect(isExpoPushToken(token)).toBe(Expo.isExpoPushToken(token));
		}
	});
});

const make = async () => {
	const db = await migratedDb();
	return { targetStore: drizzleTargetStore(db) };
};

describe("TargetStore over drizzle", () => {
	let under: Awaited<ReturnType<typeof make>>;
	let store: TargetStore;
	beforeEach(async () => {
		under = await make();
		store = under.targetStore;
	});

	test("a Person without targets has none, and unknown ids find nothing", async () => {
		expect(await store.of("ada")).toEqual([]);
		expect(await store.byIds([])).toEqual([]);
		expect(await store.byIds(["nobody-has-it"])).toEqual([]);
	});

	test("adds a target and gives it back, oldest first, for its Person only", async () => {
		const later = await store.upsert(target("t2", "ada", { at: 2_000 }));
		const first = await store.upsert(target("t1", "ada"));
		await store.upsert(target("t3", "bob"));
		expect(first).toEqual({
			id: "t1",
			personId: "ada",
			kind: "web",
			name: "Safari",
			platform: "",
			endpoint: "https://web.push.apple.com/t1",
			keys: { p256dh: "key", auth: "secret" },
			sessionId: null,
			createdAt: 1_000,
			lastSeenAt: 1_000,
		});
		expect(await store.of("ada")).toEqual(
			[first, later].flatMap((kept) => (kept ? [kept] : [])),
		);
		expect(later?.id).toBe("t2");
		expect((await store.byIds(["t3", "t9"])).map((t) => t.id)).toEqual(["t3"]);
	});

	test("one target per endpoint of a Person: a second one renames it and marks it seen", async () => {
		await store.upsert(target("t1", "ada", { sessionId: "s1" }));
		const again = await store.upsert(
			target("t2", "ada", {
				endpoint: "https://web.push.apple.com/t1",
				name: "Safari on MacBook",
				keys: null,
				at: 2_000,
			}),
		);
		expect(again).toMatchObject({
			id: "t1",
			name: "Safari on MacBook",
			keys: null,
			sessionId: null,
			createdAt: 1_000,
			lastSeenAt: 2_000,
		});
		expect(await store.of("ada")).toHaveLength(1);
	});

	test("drops a phone token of every other Person, and nothing else", async () => {
		const phone = { kind: "expo" as const, endpoint: "ExponentPushToken[x]" };
		await store.upsert(target("ada-phone", "ada", phone));
		await store.upsert(target("bob-phone", "bob", phone));
		await store.upsert(
			target("cy-web", "cy", { endpoint: "ExponentPushToken[x]" }),
		);
		await store.dropPhoneOfOthers("bob", "ExponentPushToken[x]");
		expect(await store.of("ada")).toEqual([]);
		expect((await store.of("bob")).map((t) => t.id)).toEqual(["bob-phone"]);
		expect((await store.of("cy")).map((t) => t.id)).toEqual(["cy-web"]);
	});

	test("a Person removes only their own targets", async () => {
		await store.upsert(target("t1", "ada"));
		expect(await store.remove("bob", "t1")).toBeNull();
		expect((await store.remove("ada", "t1"))?.id).toBe("t1");
		expect(await store.of("ada")).toEqual([]);
		expect(await store.remove("ada", "t1")).toBeNull();
	});

	test("removing one target leaves the Person's others", async () => {
		await store.upsert(target("t1", "ada"));
		await store.upsert(target("t2", "ada"));
		expect((await store.remove("ada", "t1"))?.id).toBe("t1");
		expect((await store.of("ada")).map((t) => t.id)).toEqual(["t2"]);
	});

	test("forgets these targets", async () => {
		await store.upsert(target("t1", "ada"));
		await store.upsert(target("t2", "ada"));
		await store.upsert(target("t3", "ada"));
		await store.forget([]);
		await store.forget(["t1", "t3"]);
		expect((await store.of("ada")).map((t) => t.id)).toEqual(["t2"]);
	});
});
