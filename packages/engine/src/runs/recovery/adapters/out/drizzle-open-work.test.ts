import { beforeEach, describe, expect, test } from "bun:test";
import type { LoggedEvent } from "../../../../log";
import { type EventSpec, FAR, HERE, recoveryGround } from "../../test-support";
import { drizzleOpenWork } from "./drizzle-open-work";

/** Where a run is walked: here, on another Device, or moved here and not arrived. */
type Where = "here" | "elsewhere" | "arriving";

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

const make = async () => {
	const ground = await recoveryGround();
	return {
		openWork: drizzleOpenWork(ground.deps),
		async add(runId: string, events: readonly EventSpec[], where: Where) {
			// A run moved here and not arrived: its row names this computer,
			// and its log ends with the move its old Walker wrote.
			await ground.addRun(runId, events, {
				walkerId: where === "elsewhere" ? FAR : HERE,
				writer: where === "here" ? HERE : FAR,
			});
			if (where === "arriving") await ground.moveHere(runId);
		},
		letGone: () => ground.letGone,
	};
};

describe("OpenWork over drizzle", () => {
	let under: Awaited<ReturnType<typeof make>>;
	beforeEach(async () => {
		under = await make();
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
		expect([...(await under.openWork.walkedHere()).keys()]).toEqual(["run-1"]);
	});

	test("a run that moved here and has not arrived is left out", async () => {
		await under.add("run-1", STARTED, "here");
		await under.add("run-moving", STARTED, "arriving");
		expect([...(await under.openWork.walkedHere()).keys()]).toEqual(["run-1"]);
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
