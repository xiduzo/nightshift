import { describe, expect, test } from "bun:test";
import type { Flow } from "@nightshift/flows";
import type { EnginePayloads, RunRow } from "../../../log";
import { runRecord } from "../../access/adapters/out/in-memory-run-records";
import {
	eventsOf,
	inMemoryRecoveryPorts,
} from "../adapters/out/in-memory-neighbours";
import { type CheckResumePorts, checkResume } from "./check-resume";

/**
 * Where the facts of `resumeBlock` come from: the run's record as Night
 * Shift reads it, its flow's own switch, and the folder of its worktree as
 * its row and its log say. The rule itself is `resume-block.test.ts`.
 */

const RUN_ID = "run-1";
const started = {
	projectId: "project-1",
	flowName: "f",
	title: "f",
	start: "a",
} as EnginePayloads["RunStarted"];

/** A run that started, and nothing else. */
const justStarted = () => eventsOf(RUN_ID).push("RunStarted", started).state();

/** Ports with the run's row (unless null) and its worktree folder `/work/run-1` there. */
function setup(
	row: Partial<RunRow> | null = {},
	overrides: Partial<CheckResumePorts> = {},
) {
	const ports = inMemoryRecoveryPorts();
	if (row) {
		ports.runs.add(
			runRecord({
				id: RUN_ID,
				spaceId: "space-1",
				worktreePath: "/work/run-1",
				branch: "nightshift/run-1",
				...row,
			}),
		);
	}
	ports.workplaces.folder("/work/run-1");
	const check = checkResume({
		openRun: ports.openRun,
		workplaces: ports.workplaces,
		schedulerOn: true,
		settings: () => ({ scheduler: true, resumeInterruptedRuns: true }),
		now: () => 10_000,
		flowOf: (r) => JSON.parse(r.flow) as Flow,
		worktreeOf: ports.worktreeOf,
		awaitsWorktree: ports.awaitsWorktree,
		...overrides,
	});
	return { ports, check };
}

describe("checkResume", () => {
	test("a run whose worktree is there continues", async () => {
		const { ports, check } = setup();
		expect(await check(RUN_ID, justStarted())).toBeNull();
		expect(ports.workplaces.asked).toEqual(["/work/run-1"]);
	});

	test("a run this Replica does not have: its record is missing", async () => {
		const { check } = setup(null);
		expect(await check(RUN_ID, justStarted())).toBe(
			"the run's record is missing.",
		);
	});

	test("the flow's own switch comes from the run's snapshot", async () => {
		const { check } = setup({
			flow: JSON.stringify({ policy: { resumeInterruptedRuns: false } }),
		});
		expect(await check(RUN_ID, justStarted())).toBe(
			"its flow turns automatic resume off.",
		);
	});

	test("a worktree a step made later is checked from the log", async () => {
		const { ports, check } = setup({ worktreePath: "", branch: "" });
		const state = eventsOf(RUN_ID)
			.push("RunStarted", started)
			.push("WorktreeCreated", {
				worktreePath: "/work/gone",
				branch: "nightshift/b",
				baseRef: "main",
			})
			.state();
		expect(await check(RUN_ID, state)).toBe(
			"the copy of the project it worked in is gone.",
		);
		expect(ports.workplaces.asked).toEqual(["/work/gone"]);
	});

	test("a run that waits for its worktree asks for no folder", async () => {
		const { ports, check } = setup({ worktreePath: "", branch: "" });
		expect(await check(RUN_ID, justStarted())).toBeNull();
		expect(ports.workplaces.asked).toEqual([]);
	});

	test("a run placed on another Device asks for no folder", async () => {
		const { ports, check } = setup(
			{ worktreePath: "/far/run-1" },
			{ placedElsewhere: (row) => row.worktreePath.startsWith("/far") },
		);
		expect(await check(RUN_ID, justStarted())).toBeNull();
		expect(ports.workplaces.asked).toEqual([]);
	});

	test("a run that cannot be read is a reason, not a crash", async () => {
		const { check } = setup(
			{},
			{
				openRun: async () => {
					throw new Error("the database is locked");
				},
			},
		);
		expect(await check(RUN_ID, justStarted())).toBe(
			"Night Shift could not check it: the database is locked",
		);
	});
});
