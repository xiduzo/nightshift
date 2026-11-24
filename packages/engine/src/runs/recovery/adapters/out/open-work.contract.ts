import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { EngineEventType, LoggedEvent } from "../../../../log";
import type { OpenWork } from "../../application/ports";

/** One event of a run's log, as a test writes it. */
export type EventSpec = {
	type: EngineEventType;
	payload: unknown;
	stepId?: string;
	sessionId?: string;
};

/** Where a run is walked: here, on another Device, or moved here and not arrived. */
export type Where = "here" | "elsewhere" | "arriving";

/** One adapter of `OpenWork` to test. */
export type OpenWorkUnderTest = {
	openWork: OpenWork;
	/** Adds a run of the project with its log, walked where `where` says. */
	add(runId: string, events: readonly EventSpec[], where: Where): Promise<void>;
	/** The runs that let go of what they hold, in order. */
	letGone(): string[];
	close(): Promise<void>;
};

/** A run that started, and its agent step `s1` that started. */
const STARTED: readonly EventSpec[] = [
	{
		type: "RunStarted",
		payload: { projectId: "project-1", flowName: null, title: "t", start: "a" },
	},
	{
		type: "StepStarted",
		stepId: "s1",
		payload: {
			nodeId: "a",
			nodeType: "agent",
			visit: 1,
			transcriptPath: "/t/s1",
			logPath: null,
			scope: null,
		},
	},
];

const types = (events: readonly LoggedEvent[] | undefined) =>
	(events ?? []).map((e) => e.type);

/**
 * What every adapter of `OpenWork` does: it gives the lifecycle events of
 * the runs this computer walks, without the runs that still arrive, and it
 * ends a run's open work as a dead daemon's cut does.
 * `open-work.contract.test.ts` runs it on the in-memory adapter and on the
 * real one over libsql in memory.
 */
export function openWorkContract(
	name: string,
	make: () => Promise<OpenWorkUnderTest>,
): void {
	describe(`OpenWork contract: ${name}`, () => {
		let under: OpenWorkUnderTest;
		beforeEach(async () => {
			under = await make();
		});
		afterEach(async () => {
			await under.close();
		});

		test("pruning the checkpoints settles when there is nothing to prune", async () => {
			await under.openWork.pruneCheckpoints();
			expect(await under.openWork.walkedHere()).toEqual(new Map());
		});

		test("walkedHere gives the lifecycle events of the runs this computer walks, by run", async () => {
			await under.add(
				"run-1",
				[
					...STARTED,
					{
						type: "RunWarned",
						payload: { kind: "cost-unknown", message: "Unknown cost" },
					},
				],
				"here",
			);
			const byRun = await under.openWork.walkedHere();
			expect([...byRun.keys()]).toEqual(["run-1"]);
			expect(types(byRun.get("run-1"))).toEqual(["RunStarted", "StepStarted"]);
		});

		test("a run another Device walks is left out", async () => {
			await under.add("run-1", STARTED, "here");
			await under.add("run-far", STARTED, "elsewhere");
			expect([...(await under.openWork.walkedHere()).keys()]).toEqual([
				"run-1",
			]);
		});

		test("a run that moved here and has not arrived is left out", async () => {
			await under.add("run-1", STARTED, "here");
			await under.add("run-moving", STARTED, "arriving");
			expect([...(await under.openWork.walkedHere()).keys()]).toEqual([
				"run-1",
			]);
		});

		test("close ends the open step and the run as interrupted, with the reason", async () => {
			await under.add("run-1", STARTED, "here");
			await under.openWork.close("run-1", {
				kind: "interrupted",
				reason: "Night Shift stopped while this run ran.",
			});
			const events = (await under.openWork.walkedHere()).get("run-1") ?? [];
			expect(types(events)).toEqual([
				"RunStarted",
				"StepStarted",
				"StepEnded",
				"RunEnded",
			]);
			expect(events[2]).toMatchObject({
				stepId: "s1",
				payload: {
					outcome: "interrupted",
					error: "Night Shift stopped while this ran.",
				},
			});
			expect(events[3]?.payload).toMatchObject({
				status: "interrupted",
				reason: "Night Shift stopped while this run ran.",
			});
		});

		test("close of a run with nothing open appends nothing", async () => {
			await under.add(
				"run-1",
				[
					STARTED[0] as EventSpec,
					{ type: "RunEnded", payload: { status: "finished", reason: null } },
				],
				"here",
			);
			await under.openWork.close("run-1", {
				kind: "interrupted",
				reason: "Night Shift stopped while this run ran.",
			});
			expect(types((await under.openWork.walkedHere()).get("run-1"))).toEqual([
				"RunStarted",
				"RunEnded",
			]);
		});

		test("letGo lets go of what the run holds", async () => {
			await under.add("run-1", STARTED, "here");
			await under.openWork.letGo("run-1");
			expect(under.letGone()).toEqual(["run-1"]);
		});
	});
}
