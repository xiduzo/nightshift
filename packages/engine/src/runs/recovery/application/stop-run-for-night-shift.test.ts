import { describe, expect, test } from "bun:test";
import { inMemoryRecoveryPorts } from "../adapters/out/in-memory-neighbours";
import { stopRunForNightShift } from "./stop-run-for-night-shift";

/** Night Shift's own stop of a run, on in-memory adapters. */

describe("stopRunForNightShift", () => {
	test("stops the run in a Turn, by the daemon, not by a person", async () => {
		const ports = inMemoryRecoveryPorts();
		await stopRunForNightShift(ports)("run-1");
		expect(ports.turns.taken).toEqual([
			{ runId: "run-1", intent: { kind: "stop", by: "daemon" } },
		]);
	});

	test("a runner that lets go refuses the stop, and the caller sees it", async () => {
		const ports = inMemoryRecoveryPorts();
		ports.turns.release();
		expect(stopRunForNightShift(ports)("run-1")).rejects.toThrow(
			"Night Shift is restarting. Try again in a moment.",
		);
	});
});
