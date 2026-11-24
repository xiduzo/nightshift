import { describe, expect, test } from "bun:test";
import type { RegisterTarget } from "../domain/push-targets";
import { targetsPorts } from "../test-support";
import { registerTarget } from "./register-target";

/** The use case registerTarget, over a database in memory. */

const phone = (endpoint = "ExponentPushToken[shared]"): RegisterTarget => ({
	kind: "expo",
	name: "Team phone",
	endpoint,
});

describe("registerTarget", () => {
	test("a screen registers once per endpoint; registering again renames it and marks it seen", async () => {
		const ports = await targetsPorts();
		const register = registerTarget(ports);
		const safari = {
			kind: "web" as const,
			name: "Safari",
			endpoint: "https://push.example/abc",
			keys: { p256dh: "key", auth: "secret" },
		};
		const first = await register({
			personId: "ada",
			screen: safari,
			sessionId: "session-1",
		});
		ports.time = 2_000;
		const again = await register({
			personId: "ada",
			screen: { ...safari, name: "Safari on MacBook" },
			sessionId: null,
		});

		expect(again).toEqual({
			id: first.id,
			kind: "web",
			name: "Safari on MacBook",
			platform: "",
			createdAt: 1_000,
			lastSeenAt: 2_000,
		});
		expect(await ports.allTargets()).toMatchObject([
			{ keys: { p256dh: "key", auth: "secret" }, sessionId: null },
		]);
	});

	test("reaches only the Person who signed in on it last", async () => {
		const ports = await targetsPorts();
		const register = registerTarget(ports);
		await register({
			personId: "ada",
			screen: phone(),
			sessionId: "ada-phone",
		});
		// Ada signed out while the phone was offline; Bob signs in on it.
		const bobs = await register({
			personId: "bob",
			screen: phone(),
			sessionId: "bob-phone",
		});

		expect((await ports.allTargets()).map((t) => [t.personId, t.id])).toEqual([
			["bob", bobs.id],
		]);
	});

	test("refuses a screen it cannot read, and keeps nothing", async () => {
		const ports = await targetsPorts();
		await expect(
			registerTarget(ports)({
				personId: "ada",
				screen: { kind: "web", name: "", endpoint: "x" },
				sessionId: null,
			}),
		).rejects.toThrow();
		expect(await ports.allTargets()).toEqual([]);
	});

	test("says what went wrong when the store keeps nothing", async () => {
		const ports = await targetsPorts();
		const targetStore = { ...ports.targetStore, upsert: async () => null };
		await expect(
			registerTarget({ ...ports, targetStore })({
				personId: "ada",
				screen: phone(),
				sessionId: null,
			}),
		).rejects.toThrow(
			"Night Shift could not turn on notifications here. Try again.",
		);
	});
});
