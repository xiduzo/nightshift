import { describe, expect, test } from "bun:test";
import { inMemoryTargetsPorts } from "../adapters/out/in-memory-neighbours";
import type { RegisterTarget } from "../domain/push-targets";
import { registerTarget } from "./register-target";

/** The use case registerTarget, on in-memory adapters. */

const phone = (endpoint = "ExponentPushToken[shared]"): RegisterTarget => ({
	kind: "expo",
	name: "Team phone",
	endpoint,
});

describe("registerTarget", () => {
	test("a screen registers once per endpoint; registering again renames it and marks it seen", async () => {
		const ports = inMemoryTargetsPorts();
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
		expect(ports.targetStore.all()).toMatchObject([
			{ keys: { p256dh: "key", auth: "secret" }, sessionId: null },
		]);
	});

	test("reaches only the Person who signed in on it last", async () => {
		const ports = inMemoryTargetsPorts();
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

		expect(ports.targetStore.all().map((t) => [t.personId, t.id])).toEqual([
			["bob", bobs.id],
		]);
	});

	test("refuses a screen it cannot read, and keeps nothing", async () => {
		const ports = inMemoryTargetsPorts();
		await expect(
			registerTarget(ports)({
				personId: "ada",
				screen: { kind: "web", name: "", endpoint: "x" },
				sessionId: null,
			}),
		).rejects.toThrow();
		expect(ports.targetStore.all()).toEqual([]);
	});

	test("says what went wrong when the store keeps nothing", async () => {
		const ports = inMemoryTargetsPorts();
		ports.targetStore.keepNothingNext();
		await expect(
			registerTarget(ports)({
				personId: "ada",
				screen: phone(),
				sessionId: null,
			}),
		).rejects.toThrow(
			"Night Shift could not turn on notifications here. Try again.",
		);
	});
});
