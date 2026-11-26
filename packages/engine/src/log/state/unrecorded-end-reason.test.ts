import { describe, expect, test } from "bun:test";
import type { RunEnding, RunEndReason } from "../events";
import { foldRun } from "./fold-run";
import { unrecordedEndReason } from "./unrecorded-end-reason";

/**
 * A `RunEnded` logged without a code: the fold reads one from the sentence
 * the engine wrote then. A run that finished is `finished`, whatever its
 * message says.
 */

const ROWS: [RunEnding, string | null, RunEndReason][] = [
	["finished", null, "finished"],
	["finished", "Usage limit: 5 users", "finished"],
	["finished", "The server showed no activity", "finished"],
	[
		"stopped",
		"Usage limit: You've hit your limit. It resets after the stop time, so the run stopped. Resume the run to continue.",
		"agent.usage_limit",
	],
	[
		"stopped",
		"The network is down: offline. The next try is after the stop time, so the run stopped. Resume the run to continue.",
		"agent.network",
	],
	[
		"failed",
		'Node "w" failed: The network was down for more than 5 min: offline',
		"agent.network",
	],
	["stopped", "Reached the stop time", "stop_time"],
	[
		"failed",
		"The run spent $3.00 of its $1.00 budget, so it stopped. Resume it to spend up to $1.00 more.",
		"guard.budget",
	],
	[
		"failed",
		'Node "w" failed: The agent reached its limit of 4 turns, so the step stopped.',
		"guard.turns",
	],
	[
		"failed",
		'Node "w" failed: The agent called Read 3 times in a row with the same input, so the step stopped.',
		"guard.looping",
	],
	[
		"failed",
		'Node "w" failed: The agent showed no activity for 1 min, so the step stopped.',
		"guard.idle",
	],
	[
		"failed",
		'The run reached the limit of 10 steps before node "w". Resume it to continue.',
		"guard.max_steps",
	],
	["stopped", null, "stopped_by_person"],
	["stopped", "Stopped after the running step, as asked.", "stopped_by_person"],
	["failed", "Something else.", "_OTHER"],
	["interrupted", "Night Shift stopped.", "_OTHER"],
];

describe("the code of an end logged without one", () => {
	for (const [status, reason, code] of ROWS) {
		test(`${status}, "${reason}": ${code}`, () => {
			expect(unrecordedEndReason({ status, reason, result: null })).toBe(code);
		});
	}

	test("a failed End's result is not a finished run", () => {
		expect(
			unrecordedEndReason({ status: "failed", reason: null, result: "failed" }),
		).toBe("_OTHER");
	});

	test("the fold reads it only when the log has no code", () => {
		const end = (endReason?: RunEndReason) =>
			foldRun([
				{
					seq: 1,
					at: 1,
					runId: "r",
					stepId: null,
					sessionId: null,
					type: "RunEnded",
					payload: {
						status: "failed",
						reason: "The server showed no activity",
						...(endReason ? { endReason } : {}),
					},
				},
			]).end?.endReason;
		expect(end()).toBe("guard.idle");
		expect(end("_OTHER")).toBe("_OTHER");
	});
});
