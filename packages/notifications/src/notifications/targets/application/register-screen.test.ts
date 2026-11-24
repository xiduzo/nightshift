import { describe, expect, test } from "bun:test";
import { inMemoryTargetsPorts } from "../adapters/out/in-memory-neighbours";
import { registerScreen } from "./register-screen";
import { registerTarget } from "./register-target";

/** The use case registerScreen, on in-memory adapters. */

describe("registerScreen", () => {
	test("the screen is of the Person who asks, with their session", async () => {
		const ports = inMemoryTargetsPorts();
		const register = registerScreen({ registerTarget: registerTarget(ports) });
		for (const personId of ["ada", "bob"]) {
			await register(
				{ personId, door: "session" },
				{
					screen: {
						kind: "expo",
						name: "Phone",
						endpoint: `ExponentPushToken[${personId}]`,
					},
					sessionId: `${personId}-phone`,
				},
			);
		}
		expect(
			ports.targetStore.all().map((t) => [t.personId, t.sessionId, t.endpoint]),
		).toEqual([
			["ada", "ada-phone", "ExponentPushToken[ada]"],
			["bob", "bob-phone", "ExponentPushToken[bob]"],
		]);
	});
});
