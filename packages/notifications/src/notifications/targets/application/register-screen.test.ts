import { describe, expect, test } from "bun:test";
import { targetsPorts } from "../test-support";
import { registerScreen } from "./register-screen";
import { registerTarget } from "./register-target";

/** The use case registerScreen, over a database in memory. */

describe("registerScreen", () => {
	test("the screen is of the Person who asks, with their session", async () => {
		const ports = await targetsPorts();
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
			(await ports.allTargets()).map((t) => [
				t.personId,
				t.sessionId,
				t.endpoint,
			]),
		).toEqual([
			["ada", "ada-phone", "ExponentPushToken[ada]"],
			["bob", "bob-phone", "ExponentPushToken[bob]"],
		]);
	});
});
