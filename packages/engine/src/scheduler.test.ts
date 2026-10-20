import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fakeHarness } from "@nightshift/agents/testing";
import { event, run } from "@nightshift/db/schema";
import type { Flow, Schedule } from "@nightshift/flows";
import { writeFlowFile, writeSchedulesFile } from "@nightshift/flows/files";
import { asc, inArray } from "drizzle-orm";

import { createEngine, type EngineInternals } from "./engine";
import { appendEvent, type EnginePayloads, parseEventRow } from "./events";
import { SCHEDULE_GRACE_MS } from "./scheduler";
import { defaultRunSettings, type RunSettings } from "./settings";
import {
	createSandbox,
	type Sandbox,
	type TestEngineOptions,
	waitFor,
	withDevice,
} from "./test-support";
import type { RunSummary, SpaceEngine } from "./types";

/** The scheduler with an injected clock: each test moves `clock` and waits for a tick. */

const TICK_MS = 5;
let sandbox: Sandbox;
let clock: number;
let engines: AbortController[];

beforeEach(async () => {
	sandbox = await createSandbox();
	clock = at(16, 21, 59);
	engines = [];
});
afterEach(async () => {
	for (const controller of engines) controller.abort();
	// Let a tick that is under way settle before the database goes.
	await Bun.sleep(TICK_MS * 4);
	await sandbox.cleanup();
});

/** Local time on the daemon's clock, October 2026 (the 16th is a Friday). */
function at(day: number, hours: number, minutes = 0, seconds = 0): number {
	return new Date(2026, 9, day, hours, minutes, seconds).getTime();
}

/** A daemon. Abort its controller to let it die. */
function startDaemon(
	options: Pick<
		TestEngineOptions,
		"maxConcurrentRuns" | "scheduler" | "settings"
	> = {},
	internals: EngineInternals = {},
): { engine: SpaceEngine; die: () => void } {
	const controller = new AbortController();
	engines.push(controller);
	const engine = createEngine(
		withDevice({
			db: sandbox.db,
			harnesses: { "claude-code": fakeHarness() },
			dataDir: sandbox.dataDir,
			...options,
		}),
		{
			now: () => clock,
			scheduleTickMs: TICK_MS,
			signal: controller.signal,
			...internals,
		},
	).space(sandbox.spaceId);
	return { engine, die: () => controller.abort() };
}

function commandFlow(command = "echo night", extra: Partial<Flow> = {}): Flow {
	return {
		version: 5,
		inputs: [{ name: "epic", type: "text" }],
		outputs: [],
		start: "work",
		nodes: [
			{
				id: "work",
				type: "command",
				position: { x: 0, y: 0 },
				command,
				output: "text",
			},
		],
		edges: [],
		...extra,
	};
}

/** Waits at a Gate until a person answers: a run that stays open. */
function gateFlow(): Flow {
	return {
		version: 5,
		inputs: [],
		outputs: [],
		start: "ask",
		nodes: [
			{
				id: "ask",
				type: "decision",
				position: { x: 0, y: 0 },
				prompt: "Go on?",
				options: [{ name: "yes" }],
				by: "person",
				decider: "typesafe",
			},
		],
		edges: [],
	};
}

function nightly(extra: Partial<Schedule> = {}): Schedule {
	return {
		id: "nightly",
		flow: "night",
		inputs: {},
		cron: "0 22 * * *",
		enabled: true,
		...extra,
	};
}

type ScheduleFact =
	| { type: "ScheduleFired"; payload: EnginePayloads["ScheduleFired"] }
	| { type: "ScheduleSkipped"; payload: EnginePayloads["ScheduleSkipped"] };

async function scheduleFacts(): Promise<ScheduleFact[]> {
	const rows = await sandbox.db
		.select()
		.from(event)
		.where(inArray(event.type, ["ScheduleFired", "ScheduleSkipped"]))
		.orderBy(asc(event.seq));
	return rows.map(parseEventRow) as ScheduleFact[];
}

async function waitForFacts(count: number): Promise<ScheduleFact[]> {
	return waitFor(
		async () => {
			const facts = await scheduleFacts();
			return facts.length >= count ? facts : null;
		},
		{ label: `${count} schedule facts`, timeoutMs: 15_000 },
	);
}

/** The run a `ScheduleFired` started. Throws on anything else. */
function firedRunId(fact: ScheduleFact | undefined): string {
	if (fact?.type !== "ScheduleFired" || !fact.payload.runId) {
		throw new Error(`Expected a fired schedule, got ${JSON.stringify(fact)}`);
	}
	return fact.payload.runId;
}

/** Enough ticks for anything that would happen to have happened. */
const settle = () => Bun.sleep(TICK_MS * 12);

async function setup(engine: SpaceEngine, schedules: Schedule[], flow?: Flow) {
	const project = await engine.addProject({ repoPath: sandbox.repoPath });
	await writeFlowFile(sandbox.repoPath, "night", flow ?? commandFlow());
	await writeSchedulesFile(sandbox.repoPath, schedules);
	return project;
}

async function waitForEnd(
	engine: SpaceEngine,
	runId: string,
): Promise<RunSummary> {
	return waitFor(
		async () => {
			const runs = await engine.listRuns();
			const run = runs.find((r) => r.id === runId);
			return run && run.status !== "running" ? run : null;
		},
		{ label: "the run to end", timeoutMs: 15_000 },
	);
}

describe("the scheduler", () => {
	test("fires once at the cron time, with the schedule as the trigger", async () => {
		const { engine } = startDaemon();
		const project = await setup(engine, [
			nightly({ inputs: { epic: "42" }, stopAt: "07:00" }),
		]);
		await settle();
		expect(await scheduleFacts()).toEqual([]);
		expect((await engine.listSchedules(project.id)).schedules[0]?.nextAt).toBe(
			at(16, 22),
		);

		clock = at(16, 22, 0, 20);
		const [fired] = await waitForFacts(1);
		await settle();
		expect(await scheduleFacts()).toHaveLength(1);
		expect(fired?.type).toBe("ScheduleFired");
		const payload = fired?.payload as EnginePayloads["ScheduleFired"];
		expect(payload).toMatchObject({
			projectId: project.id,
			scheduleId: "nightly",
			at: at(16, 22),
			error: null,
		});

		const runs = await engine.listRuns();
		expect(runs).toHaveLength(1);
		const run = runs[0] as RunSummary;
		expect(run.id).toBe(firedRunId(fired));
		expect(run.trigger).toEqual({
			kind: "schedule",
			scheduleId: "nightly",
			at: at(16, 22),
		});
		expect(run.flowName).toBe("night");
		expect(run.inputs).toEqual({ epic: "42" });
		// The first 07:00 after the start.
		expect(run.stopAt).toBe(at(17, 7));
		expect((await waitForEnd(engine, run.id)).status).toBe("finished");

		const list = await engine.listSchedules(project.id);
		expect(list.issues).toEqual([]);
		expect(list.schedules).toEqual([
			{
				...nightly({ inputs: { epic: "42" }, stopAt: "07:00" }),
				nextAt: at(17, 22),
				last: {
					kind: "fired",
					at: at(16, 22),
					runId: run.id,
					runStatus: "finished",
				},
				issues: [],
			},
		]);
	});

	test("a run started by hand says so", async () => {
		const { engine } = startDaemon({ scheduler: false });
		const project = await setup(engine, []);
		const run = await engine.startRun({
			projectId: project.id,
			flowName: "night",
		});
		expect(run.trigger).toEqual({ kind: "manual" });
		await waitForEnd(engine, run.id);
	});

	test("never fires the same cron time twice across a restart", async () => {
		const first = startDaemon();
		await setup(first.engine, [nightly()]);
		clock = at(16, 22, 1);
		const [fired] = await waitForFacts(1);
		const runId = firedRunId(fired);
		await waitForEnd(first.engine, runId);
		first.die();

		const second = startDaemon();
		clock = at(16, 22, 5);
		await second.engine.listProjects();
		await settle();
		expect(await scheduleFacts()).toHaveLength(1);
		expect(await second.engine.listRuns()).toHaveLength(1);
	});

	test("the run's own start counts as fired when the daemon died before ScheduleFired", async () => {
		const first = startDaemon({ scheduler: false });
		const project = await setup(first.engine, [nightly()]);
		first.die();
		// What the scheduler leaves when it dies between the start and its record.
		await sandbox.db.insert(run).values({
			id: "cut-short",
			spaceId: sandbox.spaceId,
			projectId: project.id,
			flow: "{}",
			title: "night",
			worktreePath: sandbox.repoPath,
			branch: "nightshift/cut-short",
			baseRef: "main",
			walkerId: sandbox.deviceId,
		});
		await appendEvent(
			sandbox.db,
			{
				runId: "cut-short",
				type: "RunStarted",
				payload: {
					projectId: project.id,
					flowName: "night",
					title: "night",
					start: "work",
					stopAt: null,
					inputs: {},
					trigger: { kind: "schedule", scheduleId: "nightly", at: at(16, 22) },
				} satisfies EnginePayloads["RunStarted"],
			},
			sandbox.deviceId,
		);

		clock = at(16, 22, 3);
		const second = startDaemon();
		await second.engine.listProjects();
		await settle();
		expect(await scheduleFacts()).toEqual([]);
		expect(
			(await second.engine.listSchedules(project.id)).schedules[0]?.last,
		).toEqual({
			kind: "fired",
			at: at(16, 22),
			runId: "cut-short",
			runStatus: "interrupted",
		});
	});

	test("a time missed by less than 15 minutes fires after a restart", async () => {
		clock = at(16, 22, 14);
		const { engine } = startDaemon();
		await setup(engine, [nightly()]);
		const [fired] = await waitForFacts(1);
		expect(fired).toMatchObject({
			type: "ScheduleFired",
			payload: { at: at(16, 22), error: null },
		});
		const runId = firedRunId(fired);
		await waitForEnd(engine, runId);
	});

	test("a time missed by more than 15 minutes is skipped, with the reason", async () => {
		const first = startDaemon();
		const project = await setup(first.engine, [nightly()]);
		clock = at(16, 22);
		const [fired] = await waitForFacts(1);
		const runId = firedRunId(fired);
		await waitForEnd(first.engine, runId);
		first.die();

		// Down all day; back the next evening, 30 minutes after the time.
		clock = at(17, 22, 30);
		const second = startDaemon();
		const facts = await waitForFacts(2);
		await settle();
		expect(await scheduleFacts()).toHaveLength(2);
		expect(facts[1]).toMatchObject({
			type: "ScheduleSkipped",
			payload: {
				scheduleId: "nightly",
				at: at(17, 22),
				reason: expect.stringContaining("Missed by 30 min"),
				runId: null,
			},
		});
		expect(await second.engine.listRuns()).toHaveLength(1);
		const [listed] = (await second.engine.listSchedules(project.id)).schedules;
		expect(listed?.last).toMatchObject({ kind: "skipped", at: at(17, 22) });
		expect(listed?.nextAt).toBe(at(18, 22));
		expect(SCHEDULE_GRACE_MS).toBe(15 * 60_000);
	});

	test("a time the daemon watched come due but slept through is skipped", async () => {
		const { engine } = startDaemon();
		await setup(engine, [nightly()]);
		await settle();
		// The computer slept from 21:59 to 23:00.
		clock = at(16, 23);
		const [skipped] = await waitForFacts(1);
		expect(skipped).toMatchObject({
			type: "ScheduleSkipped",
			payload: { at: at(16, 22), reason: expect.stringContaining("1 h") },
		});
		expect(await engine.listRuns()).toEqual([]);
	});

	test("a schedule added after its time is not reported as missed", async () => {
		clock = at(16, 23);
		const { engine } = startDaemon();
		const project = await setup(engine, [nightly()]);
		await settle();
		expect(await scheduleFacts()).toEqual([]);
		const [listed] = (await engine.listSchedules(project.id)).schedules;
		expect(listed?.last).toBeNull();
		expect(listed?.nextAt).toBe(at(17, 22));
	});

	test("does not start while an earlier run of the schedule is still open", async () => {
		const { engine } = startDaemon();
		const project = await setup(
			engine,
			[nightly({ cron: "0 * * * *" })],
			gateFlow(),
		);
		clock = at(16, 22);
		const [fired] = await waitForFacts(1);
		const runId = firedRunId(fired);
		await waitFor(
			async () =>
				(await engine.listRuns()).find((r) => r.id === runId)?.status ===
				"waiting",
			{ label: "the run to wait at its Gate" },
		);

		clock = at(16, 23, 0, 30);
		const facts = await waitForFacts(2);
		expect(facts[1]).toMatchObject({
			type: "ScheduleSkipped",
			payload: {
				at: at(16, 23),
				reason: "An earlier run of this schedule is still waiting.",
				runId,
			},
		});
		expect(await engine.listRuns()).toHaveLength(1);
		const [listed] = (await engine.listSchedules(project.id)).schedules;
		expect(listed?.last).toMatchObject({ kind: "skipped", runId });

		// Once the run ends, the next time fires again.
		await engine.stopRun(runId);
		clock = at(16, 24, 0, 30);
		const later = await waitForFacts(3);
		expect(later[2]).toMatchObject({
			type: "ScheduleFired",
			payload: { at: at(16, 24), error: null },
		});
		const next = firedRunId(later[2]);
		await engine.stopRun(next);
	});

	test("a paused schedule does not fire", async () => {
		const { engine } = startDaemon();
		const project = await setup(engine, [nightly({ enabled: false })]);
		clock = at(16, 22, 1);
		await settle();
		expect(await scheduleFacts()).toEqual([]);
		expect(await engine.listRuns()).toEqual([]);
		expect((await engine.listSchedules(project.id)).schedules[0]?.nextAt).toBe(
			null,
		);
	});

	test("a schedule that names another Device does not fire here; one that names this one does", async () => {
		const { engine } = startDaemon();
		await setup(engine, [
			nightly({ id: "elsewhere", device: "hetzner-1" }),
			nightly({ id: "here", device: "test" }),
		]);
		clock = at(16, 22, 1);
		const facts = await waitForFacts(1);
		await settle();
		expect((await scheduleFacts()).map((f) => f.payload.scheduleId)).toEqual([
			"here",
		]);
		expect(facts).toHaveLength(1);
	});

	test("picks up an edit of the file on the next tick, without a restart", async () => {
		const { engine } = startDaemon();
		const project = await setup(engine, [nightly({ cron: "0 23 * * *" })]);
		await settle();
		const issues = await engine.saveSchedules(project.id, [nightly()]);
		expect(issues).toEqual([]);
		clock = at(16, 22, 0, 10);
		const [fired] = await waitForFacts(1);
		expect(fired).toMatchObject({
			type: "ScheduleFired",
			payload: { at: at(16, 22), error: null },
		});
		const runId = firedRunId(fired);
		await waitForEnd(engine, runId);
	});

	test("a start that fails is recorded with its error, once", async () => {
		const { engine } = startDaemon();
		const project = await setup(engine, [nightly({ flow: "gone" })]);
		clock = at(16, 22, 1);
		const [fired] = await waitForFacts(1);
		await settle();
		expect(await scheduleFacts()).toHaveLength(1);
		expect(fired).toMatchObject({
			type: "ScheduleFired",
			payload: {
				at: at(16, 22),
				runId: null,
				error: 'The flow "gone" does not exist.',
			},
		});
		const list = await engine.listSchedules(project.id);
		expect(list.schedules[0]?.last).toEqual({
			kind: "failed",
			at: at(16, 22),
			error: 'The flow "gone" does not exist.',
		});
		expect(list.schedules[0]?.issues).toEqual([
			{
				severity: "error",
				message: 'The flow "gone" does not exist.',
				scheduleId: "nightly",
			},
		]);
	});

	test("a full run cap is recorded as the error", async () => {
		const { engine } = startDaemon({ maxConcurrentRuns: 1 });
		const project = await setup(engine, [nightly()], commandFlow("sleep 5"));
		const busy = await engine.startRun({
			projectId: project.id,
			flowName: "night",
		});
		clock = at(16, 22, 1);
		const [fired] = await waitForFacts(1);
		expect(fired).toMatchObject({
			type: "ScheduleFired",
			payload: {
				runId: null,
				error: expect.stringContaining("The run cap is reached"),
			},
		});
		await engine.stopRun(busy.id);
	});

	test("scheduler: false starts nothing", async () => {
		const { engine } = startDaemon({ scheduler: false });
		await setup(engine, [nightly()]);
		clock = at(16, 22, 1);
		await settle();
		expect(await scheduleFacts()).toEqual([]);
	});

	test("a removed project's schedules do not fire", async () => {
		const { engine } = startDaemon();
		const project = await setup(engine, [nightly()]);
		await engine.removeProject(project.id);
		clock = at(16, 22, 1);
		await settle();
		expect(await scheduleFacts()).toEqual([]);
	});

	describe("the settings' scheduler switch", () => {
		/** Settings with the switch the test flips. */
		function switchable(on: boolean) {
			const settings: RunSettings = { ...defaultRunSettings(), scheduler: on };
			return { settings, read: () => settings };
		}

		test("off skips every tick: nothing fires", async () => {
			const { read } = switchable(false);
			const { engine } = startDaemon({ settings: read });
			const project = await setup(engine, [nightly()]);
			clock = at(16, 22, 0, 20);
			await settle();
			expect(await scheduleFacts()).toEqual([]);
			expect(await engine.listRuns()).toEqual([]);
			expect(
				(await engine.listSchedules(project.id)).schedules[0]?.last,
			).toBeNull();
		});

		test("turned on again, it neither fires nor reports a time that came due while off", async () => {
			const { settings, read } = switchable(true);
			const { engine } = startDaemon({ settings: read });
			await setup(engine, [nightly()]);
			// Watching from 21:59, then off before the time.
			await settle();
			settings.scheduler = false;
			await settle();
			clock = at(16, 22, 30);
			await settle();
			settings.scheduler = true;
			await settle();
			expect(await scheduleFacts()).toEqual([]);
			expect(await engine.listRuns()).toEqual([]);

			// The next time fires as usual.
			clock = at(17, 22, 0, 10);
			const [fired] = await waitForFacts(1);
			expect(fired).toMatchObject({
				type: "ScheduleFired",
				payload: { at: at(17, 22), error: null },
			});
			await waitForEnd(engine, firedRunId(fired));
		});

		test("turned on within the grace of a time that came due while off, it does not fire it", async () => {
			const { settings, read } = switchable(false);
			const { engine } = startDaemon({ settings: read });
			await setup(engine, [nightly()]);
			await settle();
			clock = at(16, 22, 5);
			await settle();
			settings.scheduler = true;
			await settle();
			expect(await scheduleFacts()).toEqual([]);
			expect(await engine.listRuns()).toEqual([]);

			clock = at(17, 22, 0, 10);
			const [fired] = await waitForFacts(1);
			expect(fired).toMatchObject({
				type: "ScheduleFired",
				payload: { at: at(17, 22), error: null },
			});
			await waitForEnd(engine, firedRunId(fired));
		});
	});
});
