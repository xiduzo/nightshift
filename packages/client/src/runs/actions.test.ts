import { describe, expect, test } from "bun:test";

import { actedRunStatus } from "./actions";

const running = { status: "running", result: null, walkedHere: true } as const;
const stopped = { status: "stopped", result: null, walkedHere: true } as const;

describe("a run shows the result of an action at once", () => {
	test("without an action it shows its own status", () => {
		expect(actedRunStatus(running, null)).toEqual({
			status: "running",
			result: null,
		});
	});

	test("a stop on its way shows the run stopped", () => {
		expect(
			actedRunStatus(running, { action: "stop", settled: false }).status,
		).toBe("stopped");
	});

	test("a stop that Night Shift took shows stopped until the run stops", () => {
		const acting = { action: "stop", settled: true } as const;
		expect(actedRunStatus(running, acting).status).toBe("stopped");
		expect(actedRunStatus(stopped, acting).status).toBe("stopped");
		// Then the run's own status counts again: here it ended on its own.
		expect(
			actedRunStatus(
				{ status: "finished", result: "done", walkedHere: true },
				acting,
			),
		).toEqual({ status: "finished", result: "done" });
	});

	test("a resume shows the run on its way until it runs", () => {
		const sent = { action: "resume", settled: false } as const;
		const taken = { action: "resume", settled: true } as const;
		expect(actedRunStatus(stopped, sent).status).toBe("running");
		expect(actedRunStatus(stopped, taken).status).toBe("running");
		expect(actedRunStatus(running, taken).status).toBe("running");
	});

	test("a run again shows the ended run on its way until it runs", () => {
		const failed = {
			status: "failed",
			result: null,
			walkedHere: true,
		} as const;
		const sent = { action: "rerun", settled: false } as const;
		const taken = { action: "rerun", settled: true } as const;
		expect(actedRunStatus(failed, sent)).toEqual({
			status: "running",
			result: null,
		});
		// Taken, and the run still reads as failed: it shows on its way. The
		// screen lets go of the action once the run is on its way.
		expect(actedRunStatus(failed, taken).status).toBe("running");
		expect(actedRunStatus(running, taken).status).toBe("running");
	});

	test("a step restart keeps the run running", () => {
		const taken = { action: "restart", settled: true } as const;
		expect(actedRunStatus(running, taken).status).toBe("running");
		// It ended meanwhile: the run shows how.
		expect(actedRunStatus(stopped, taken).status).toBe("stopped");
	});
});
