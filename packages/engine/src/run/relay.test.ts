import { describe, expect, test } from "bun:test";
import type { Database } from "@nightshift/db";
import { Refusal } from "@nightshift/refusal";
import type { Relay, StartRunInput } from "../contract";
import type { RunLog, RunState } from "../log";
import { createRunRelay } from "./relay";
import { PinNotHereError } from "./test-run";

/**
 * The start of a run on the Host that keeps the Space (`startOnHost`). A
 * test run's pins go as refs (ADR 27): this computer reads them in its
 * own log first, and the Host reads them again in its own.
 */

/** A run of `project-1` in `space-team` whose `fetch` step ended. */
const SOURCE = {
	row: { id: "run-earlier", spaceId: "space-team", projectId: "project-1" },
	state: {
		test: null,
		steps: new Map([
			[
				"step-1",
				{
					id: "step-1",
					nodeId: "fetch",
					nodeType: "command",
					scope: null,
					endedAt: 1,
					outcome: "pass",
					outputs: { outcome: "pass", log_tail: "fresh", visit: 1 },
				},
			],
		]),
	},
};

/** This computer's log: the earlier run only. */
const log: Pick<RunLog, "events" | "row" | "state"> = {
	events: async () => [],
	row: async (runId: string) => {
		if (runId !== SOURCE.row.id) {
			throw new Refusal("not-found", "Night Shift cannot find this run.");
		}
		return SOURCE.row as never;
	},
	state: async () => SOURCE.state as unknown as RunState,
};

/** A relay whose Host takes each start, and the starts it took. */
function relayed() {
	const asked: (StartRunInput & { spaceId: string })[] = [];
	// The time runs out at once: the run never arrives here.
	let time = 0;
	const relay = createRunRelay({
		db: {} as Database,
		log,
		relay: {
			startRun: async (input) => {
				asked.push(input);
				return { runId: "run-on-host" };
			},
		} as Relay,
		now: () => (time += 60_000),
		listRuns: async () => [],
	});
	return { relay, asked };
}

const NOT_ARRIVED = "The run started. It shows in the run list in a moment.";

describe("a start on the Host", () => {
	test("hands a test run on with its pins as refs, once this computer's log has their outputs", async () => {
		const { relay, asked } = relayed();
		const marks = {
			pinned: { fetch: { runId: "run-earlier", stepId: "step-1" } },
			skipped: { approve: "send" },
		};
		await expect(
			relay.startOnHost(
				{ projectId: "project-1", flowName: "watch", test: marks },
				"space-team",
			),
		).rejects.toThrow(NOT_ARRIVED);
		// The outputs stay here: the Host reads them in its own log.
		expect(asked).toEqual([
			{
				projectId: "project-1",
				flowName: "watch",
				test: marks,
				spaceId: "space-team",
			},
		]);
	});

	test("refuses a pin this computer cannot find, and asks the Host nothing", async () => {
		const { relay, asked } = relayed();
		const lost = relay.startOnHost(
			{
				projectId: "project-1",
				flowName: "watch",
				test: { pinned: { fetch: { runId: "run-gone", stepId: "step-1" } } },
			},
			"space-team",
		);
		await expect(lost).rejects.toBeInstanceOf(PinNotHereError);
		await expect(lost).rejects.toThrow(
			'Night Shift cannot find the output you pinned on "fetch". Pin a newer output.',
		);
		// A run of another Space is as good as gone.
		await expect(
			relay.startOnHost(
				{
					projectId: "project-1",
					flowName: "watch",
					test: {
						pinned: { fetch: { runId: "run-earlier", stepId: "step-1" } },
					},
				},
				"space-other",
			),
		).rejects.toBeInstanceOf(PinNotHereError);
		expect(asked).toEqual([]);
	});

	test("a start that pins and skips nothing goes as a plain run", async () => {
		const { relay, asked } = relayed();
		await expect(
			relay.startOnHost(
				{ projectId: "project-1", flowName: "watch", test: {} },
				"space-team",
			),
		).rejects.toThrow(NOT_ARRIVED);
		expect(asked).toHaveLength(1);
		expect(asked[0]?.test).toBeUndefined();
	});
});
