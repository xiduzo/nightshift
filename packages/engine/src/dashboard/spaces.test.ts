import { describe, expect, test } from "bun:test";

import type { RunDetail, RunSummary } from "../read";
import { flowTurnedSevere } from "./spaces";

/*
 * Whether a run's end turned its flow severe, read from a Space: the
 * flow's own real runs, through the same watch as the dashboard.
 */

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

/** A run of `night` in project p1, `hoursAgo` hours ago. */
function aRun(
	id: string,
	hoursAgo: number,
	fields: Partial<RunSummary> = {},
): RunSummary {
	const walker = { id: "device-1", name: "this computer", thisDevice: true };
	const createdAt = NOW - hoursAgo * HOUR;
	return {
		id,
		projectId: "p1",
		walker,
		device: walker,
		trigger: { kind: "manual" },
		startedBy: null,
		flowName: "night",
		title: "night",
		worktreePath: "",
		branch: `nightshift/${id}`,
		baseRef: "main",
		status: "finished",
		reason: null,
		result: "done",
		wakeAt: null,
		signal: null,
		inputs: {},
		stopAt: null,
		stopAfterStep: false,
		createdAt,
		endedAt: createdAt + 60_000,
		costUsd: 0,
		costEstimated: false,
		costMissing: 0,
		costCalls: 1,
		warnings: [],
		subflows: [],
		gates: [],
		sleeps: [],
		...fields,
	};
}

function spaceOf(runs: RunSummary[]) {
	return {
		listRuns: async (input?: { projectId?: string }) =>
			runs.filter(
				(run) => !input?.projectId || run.projectId === input.projectId,
			),
		getRun: async (runId: string) => {
			const run = runs.find((one) => one.id === runId);
			if (!run) throw new Error("No such run.");
			return run as RunDetail;
		},
	};
}

const failed = { status: "failed" as const, result: null };

describe("a flow that turns severe", () => {
	const history = [
		aRun("r1", 1, failed),
		aRun("r2", 2, failed),
		aRun("r3", 3),
		aRun("r4", 4),
		// Another flow's failure is not this flow's.
		aRun("o1", 5, { ...failed, flowName: "other" }),
	];

	test("the second failure in a row turns it, with the flow and its project", async () => {
		expect(await flowTurnedSevere(spaceOf(history), "r1", NOW)).toMatchObject({
			projectId: "p1",
			flow: "night",
			runId: "r1",
			signal: { kind: "failing", severe: true, count: 2 },
		});
	});

	test("the first failure, a quick run, or a run it does not have turns nothing", async () => {
		const space = spaceOf([
			...history,
			aRun("q1", 0, { ...failed, flowName: null }),
		]);
		expect(
			await flowTurnedSevere(spaceOf(history.slice(1)), "r2", NOW),
		).toBeNull();
		expect(await flowTurnedSevere(space, "q1", NOW)).toBeNull();
		expect(await flowTurnedSevere(space, "gone", NOW)).toBeNull();
	});
});
