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
});
