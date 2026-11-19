import { describe, expect, test } from "bun:test";
import {
	endedPhones,
	type PushTarget,
	phoneSessionsOf,
	registerScreenSchema,
	targetView,
} from "./push-targets";

const target = (id: string, fields: Partial<PushTarget> = {}): PushTarget => ({
	id,
	personId: "ada",
	kind: "expo",
	name: "Pixel",
	platform: "android",
	endpoint: `ExponentPushToken[${id}]`,
	keys: null,
	sessionId: `session-${id}`,
	createdAt: 1_000,
	lastSeenAt: 2_000,
	...fields,
});

describe("a phone", () => {
	test("whose session ended gets nothing more; a browser's target does not end with its session", () => {
		const live = target("live");
		const ended = target("ended");
		const noSession = target("none", { sessionId: null });
		const browser = target("web", { kind: "web", sessionId: "gone" });
		const all = [live, ended, noSession, browser];
		expect(phoneSessionsOf(all)).toEqual(["session-live", "session-ended"]);
		expect(endedPhones(all, new Set(["session-live"]))).toEqual([ended]);
	});
});

test("a push target as its Person sees it: no endpoint, no keys", () => {
	expect(
		targetView(target("t1", { kind: "web", keys: { auth: "secret" } })),
	).toEqual({
		id: "t1",
		kind: "web",
		name: "Pixel",
		platform: "android",
		createdAt: 1_000,
		lastSeenAt: 2_000,
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
