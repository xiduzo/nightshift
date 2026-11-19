import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow } from "@nightshift/flows";
import type { NewRuns } from "../../application/ports";
import type { NewRun } from "../../application/start-run-here";

/** One adapter of `NewRuns` to test, over the runs of one Replica. */
export type NewRunsUnderTest = {
	runs: NewRuns;
	/** The Space of the project `project-1`. */
	spaceId: string;
	/** The events of a run as this Replica has them, in order. */
	events(runId: string): Promise<{ type: string; payload: unknown }[]>;
	close(): Promise<void>;
};

const flow = {
	version: FLOW_VERSION,
	inputs: [],
	outputs: [],
	start: "ship",
	nodes: [
		{
			id: "ship",
			type: "decision",
			position: { x: 0, y: 0 },
			prompt: "Ship it?",
			options: [{ name: "yes" }, { name: "no" }],
			by: "person",
		},
	],
	edges: [],
} as unknown as Flow;

/** A new run of `project-1` in `spaceId`, planned on the Device `laptop` for Ada. */
function newRun(id: string, spaceId: string): NewRun {
	const laptop = { id: "laptop", name: "Laptop" };
	return {
		id,
		spaceId,
		projectId: "project-1",
		flowName: "nightly",
		flow,
		calledFlows: {},
		flowRevision: null,
		calledFlowRevisions: {},
		title: "nightly",
		worktreePath: "/worktrees/run",
		branch: "nightshift/run",
		baseRef: "main",
		walkerId: "walker",
		plan: {
			device: laptop,
			named: {},
			devices: { laptop },
			personId: "person-ada",
		},
		started: {
			projectId: "project-1",
			flowName: "nightly",
			title: "nightly",
			start: "ship",
			stopAt: null,
			inputs: {},
			trigger: { kind: "manual" },
			startedBy: "person-ada",
		},
	};
}

/**
 * What every adapter of `NewRuns` does. `new-runs.contract.test.ts` runs
 * it on the in-memory adapter and on the one over the run log.
 */
export function newRunsContract(
	name: string,
	make: () => Promise<NewRunsUnderTest>,
): void {
	describe(`NewRuns contract: ${name}`, () => {
		let under: NewRunsUnderTest;
		beforeEach(async () => {
			under = await make();
		});
		afterEach(async () => {
			await under.close();
		});

		test("a start writes the run's row with its plan, and its RunStarted", async () => {
			const run = newRun("run-1", under.spaceId);
			const row = await under.runs.started(run);
			expect(row).toMatchObject({
				id: "run-1",
				spaceId: under.spaceId,
				projectId: "project-1",
				flowName: "nightly",
				flow: JSON.stringify(run.flow),
				bodyFlows: "{}",
				title: "nightly",
				worktreePath: "/worktrees/run",
				branch: "nightshift/run",
				baseRef: "main",
				walkerId: "walker",
				deviceId: "laptop",
				deviceNames: JSON.stringify({ laptop: "Laptop" }),
				startedBy: "person-ada",
			});
			expect(await under.events("run-1")).toEqual([
				{ type: "RunStarted", payload: run.started },
			]);
		});

		test("the row and RunStarted land together or not at all: a second start of one id leaves one of each", async () => {
			await under.runs.started(newRun("run-1", under.spaceId));
			await expect(
				under.runs.started({
					...newRun("run-1", under.spaceId),
					title: "again",
				}),
			).rejects.toThrow();
			const events = await under.events("run-1");
			expect(events.map((e) => e.type)).toEqual(["RunStarted"]);
			expect((await under.runs.pinned("run-1"))?.run).toMatchObject({
				projectId: "project-1",
				spaceId: under.spaceId,
			});
		});

		test("the run a pin names gives its project, Space and state, and an unknown run is null", async () => {
			expect(await under.runs.pinned("run-nobody-has")).toBeNull();
			await under.runs.started(newRun("run-1", under.spaceId));
			const pinned = await under.runs.pinned("run-1");
			expect(pinned?.run).toMatchObject({
				projectId: "project-1",
				spaceId: under.spaceId,
			});
			expect(pinned?.state.status).toBe("running");
			expect(pinned?.state.steps.size).toBe(0);
			expect(pinned?.state.test).toBeNull();
		});
	});
}
