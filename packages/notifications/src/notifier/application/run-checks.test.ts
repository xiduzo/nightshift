import { describe, expect, test } from "bun:test";
import { runChecks } from "./run-checks";

/** The use case runChecks: what the timer checks, at one instant, in order. */

describe("runChecks", () => {
	test("ends the device waits, sends the held pushes, ends quiet hours and prunes, at one instant", async () => {
		const done: string[] = [];
		const step =
			(name: string) =>
			async ({ at }: { at: number }) => {
				done.push(`${name} ${at}`);
			};
		let time = 1_000;

		await runChecks({
			now: () => time++,
			endWaits: step("waits"),
			sendHeld: step("held"),
			endQuiet: step("quiet"),
			prune: step("prune"),
		})();

		expect(done).toEqual([
			"waits 1000",
			"held 1000",
			"quiet 1000",
			"prune 1000",
		]);
	});
});
