import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fakeHarness } from "@nightshift/agents/testing";
import { device, event, run } from "@nightshift/db/schema";
import type { Flow, Schedule } from "@nightshift/flows";
import { FLOW_VERSION } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { iso } from "@nightshift/time";
import { atLocal } from "@nightshift/time/testing";
import { asc, eq, inArray } from "drizzle-orm";
import {
	defaultRunSettings,
	type RunSettings,
} from "../device-config/settings";
import type { EnginePayloads } from "../log/events/events";
import { appendEvent, parseEventRow } from "../log/run-log/append";
import type { RunSummary } from "../read/views";
import { createEngine, type Engine, type EngineInternals } from "../run/engine";
import type { SpaceEngine } from "../run/space-engine";
import { START_HOLD_WORDS } from "../run/start-holds";
import { seedFlows } from "../testing/seed-flows";
import {
	createSandbox,
	holdSpace,
	type Sandbox,
	type TestEngineOptions,
	waitFor,
	withDevice,
} from "../testing/test-support";

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
	return atLocal(2026, 9, day, hours, minutes, seconds);
}

/** A daemon. Abort its controller to let it die. */
function startDaemon(
	options: Pick<
		TestEngineOptions,
		"maxConcurrentRuns" | "scheduler" | "settings"
	> = {},
	internals: EngineInternals = {},
): { engine: SpaceEngine; root: Engine; die: () => void } {
	const controller = new AbortController();
	engines.push(controller);
	const root = createEngine(
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
	);
	return {
		engine: root.space(sandbox.spaceId),
		root,
		die: () => controller.abort(),
	};
}

function commandFlow(command = "echo night", extra: Partial<Flow> = {}): Flow {
	return {
		version: FLOW_VERSION,
		inputs: [{ name: "epic", type: "text" }],
		outputs: [],
		start: "work",
		nodes: [
			{
				id: "work",
				type: "command",
				position: { x: 0, y: 0 },
				command,
				stdout: "text",
			},
		],
		edges: [],
		...extra,
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
	await seedFlows(
		engine,
		project.id,
		{ night: flow ?? commandFlow() },
		schedules,
	);
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
				deliveries: [],
				issues: [],
			},
		]);
	});

	test("a scheduled run has a starter: the schedule's Person, else this computer's owner", async () => {
		const { engine } = startDaemon();
		await setup(engine, [
			nightly({ id: "mine" }),
			nightly({ id: "carols", person: "person-carol" }),
		]);
		clock = at(16, 22, 0, 20);
		const facts = await waitForFacts(2);
		const [self] = await sandbox.db
			.select({ ownerId: device.ownerId })
			.from(device)
			.where(eq(device.self, true));
		const runs = await engine.listRuns();
		const starterOf = (scheduleId: string) => {
			const fact = facts.find((f) => f.payload.scheduleId === scheduleId);
			return runs.find((r) => r.id === firedRunId(fact))?.startedBy?.id;
		};
		expect(starterOf("mine")).toBe(self?.ownerId as string);
		expect(starterOf("carols")).toBe("person-carol");
		for (const run of runs) await waitForEnd(engine, run.id);
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

	test("a missed time starts once within its lateMinutes, with the time it was due", async () => {
		// The step reads when its run was due, as a template and from its environment.
		const flow = commandFlow(
			`printf '{"due":"%s","env":"%s"}' "{{run.due_at}}" "$NS_DUE_AT" > "$NS_OUTPUT"`,
		);
		const first = startDaemon();
		const project = await setup(
			first.engine,
			[nightly({ lateMinutes: 1440 })],
			flow,
		);
		clock = at(16, 22);
		const [fired] = await waitForFacts(1);
		await waitForEnd(first.engine, firedRunId(fired));
		first.die();

		// The Host is off from 21:30 to 23:30 the next evening, over 22:00.
		clock = at(17, 23, 30);
		const second = startDaemon();
		const facts = await waitForFacts(2);
		expect(facts[1]).toMatchObject({
			type: "ScheduleFired",
			payload: { scheduleId: "nightly", at: at(17, 22), error: null },
		});
		const runId = firedRunId(facts[1]);
		const run = await waitForEnd(second.engine, runId);
		expect(run.status).toBe("finished");
		expect(run.trigger).toEqual({
			kind: "schedule",
			scheduleId: "nightly",
			at: at(17, 22),
		});
		const due = iso(at(17, 22));
		const [ended] = (
			await sandbox.db
				.select()
				.from(event)
				.where(eq(event.runId, runId))
				.orderBy(asc(event.seq))
		)
			.map(parseEventRow)
			.filter((e) => e.type === "StepEnded");
		expect(
			(ended?.payload as EnginePayloads["StepEnded"] | undefined)?.outputs.data,
		).toEqual({ due, env: due });
		second.die();

		// Started again: the time does not start a second run.
		clock = at(17, 23, 45);
		const third = startDaemon();
		await third.engine.listProjects();
		await settle();
		expect(await scheduleFacts()).toHaveLength(2);
		expect(await third.engine.listRuns()).toHaveLength(2);
		const [listed] = (await third.engine.listSchedules(project.id)).schedules;
		expect(listed?.nextAt).toBe(at(18, 22));
	});

	test("a missed time past its lateMinutes is skipped, and the Space hears of it", async () => {
		const first = startDaemon();
		const project = await setup(first.engine, [nightly({ lateMinutes: 60 })]);
		clock = at(16, 22);
		const [fired] = await waitForFacts(1);
		await waitForEnd(first.engine, firedRunId(fired));
		first.die();

		clock = at(17, 23, 30);
		const second = startDaemon();
		const told: unknown[] = [];
		second.root.onScheduleMissed((missed) => told.push(missed));
		const facts = await waitForFacts(2);
		expect(facts[1]).toMatchObject({
			type: "ScheduleSkipped",
			payload: {
				at: at(17, 22),
				reason: expect.stringContaining(
					"Missed by 1 h 30 min. Night Shift was off, or the computer was asleep. This schedule starts at most 1 h late.",
				),
			},
		});
		await waitFor(async () => (told.length > 0 ? told : null), {
			label: "the missed time to be told",
		});
		expect(told).toEqual([
			{
				spaceId: sandbox.spaceId,
				projectId: project.id,
				scheduleId: "nightly",
				flow: "night",
				at: at(17, 22),
			},
		]);
		expect(await second.engine.listRuns()).toHaveLength(1);
	});

	test("a schedule due while a merge holds the starts fires after the release, within its grace", async () => {
		const { engine, root } = startDaemon();
		const project = await setup(engine, [nightly()]);
		await settle();
		const release = await holdSpace(root, sandbox.spaceId);

		clock = at(16, 22, 0, 20);
		await settle();
		expect(await scheduleFacts()).toEqual([]);
		expect(await engine.listRuns()).toEqual([]);
		// A person's run in the held Space waits too.
		const refused = engine.startRun({
			projectId: project.id,
			flowName: "night",
		});
		await expect(refused).rejects.toBeInstanceOf(Refusal);
		await expect(refused).rejects.toThrow(START_HOLD_WORDS.held);

		clock = at(16, 22, 2);
		await release();
		const [fired] = await waitForFacts(1);
		expect(fired?.payload).toMatchObject({
			scheduleId: "nightly",
			at: at(16, 22),
			error: null,
		});
		await waitForEnd(engine, firedRunId(fired));
		await settle();
		expect(await scheduleFacts()).toHaveLength(1);
	});

	test("the computer that keeps the Space fires every schedule and runs its run there", async () => {
		const { engine } = startDaemon();
		await setup(engine, [
			nightly({ id: "here" }),
			// A list saved before schedules lost their device: it counts for nothing.
			nightly({ id: "old", device: "LE2316" } as Partial<Schedule>),
		]);
		clock = at(16, 22, 1);
		await waitForFacts(2);
		await settle();
		const facts = await scheduleFacts();
		const of = (id: string) =>
			facts.find((f) => f.payload.scheduleId === id)?.payload;
		expect(of("here")).toMatchObject({ error: null });
		expect(of("old")).toMatchObject({ error: null });
		await waitForEnd(engine, of("here")?.runId as string);
		await waitForEnd(engine, of("old")?.runId as string);
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
		await engine.act(busy.id, { kind: "stop" });
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
	});
});

describe("Pause tonight", () => {
	test("skips tonight's start, with the reason, across a restart, then fires the next evening", async () => {
		const first = startDaemon();
		const project = await setup(first.engine, [nightly()]);
		clock = at(16, 12);
		const pause = await first.engine.pauseScheduleTonight(
			project.id,
			"nightly",
		);
		// Until the first 06:00 after its next start (22:00 on the 16th).
		expect(pause).toEqual({ pausedUntil: at(17, 6), nextAt: at(17, 22) });
		const [listed] = (await first.engine.listSchedules(project.id)).schedules;
		expect(listed).toMatchObject({
			pausedUntil: at(17, 6),
			nextAt: at(17, 22),
		});

		// The pause is in the schedule: a restart keeps it.
		first.die();
		const { engine } = startDaemon();
		clock = at(16, 22, 0, 20);
		const [skipped] = await waitForFacts(1);
		expect(skipped).toMatchObject({
			type: "ScheduleSkipped",
			payload: {
				scheduleId: "nightly",
				at: at(16, 22),
				reason: "You paused this schedule for tonight.",
				runId: null,
			},
		});
		await settle();
		expect(await engine.listRuns()).toEqual([]);

		// After the morning the pause means nothing: the list drops it.
		clock = at(17, 9);
		const [after] = (await engine.listSchedules(project.id)).schedules;
		expect(after?.pausedUntil).toBeUndefined();
		expect(after?.nextAt).toBe(at(17, 22));
		expect(after?.last).toMatchObject({ kind: "skipped", at: at(16, 22) });

		clock = at(17, 22, 0, 20);
		const facts = await waitForFacts(2);
		expect(facts[1]).toMatchObject({
			type: "ScheduleFired",
			payload: { at: at(17, 22), error: null },
		});
		await waitForEnd(engine, firedRunId(facts[1]));
	});
});

describe("Run now", () => {
	test("starts the schedule's run at once, with its inputs and the schedule as the trigger", async () => {
		const { engine } = startDaemon();
		const project = await setup(engine, [
			nightly({ inputs: { epic: "42" }, stopAt: "07:00" }),
		]);
		clock = at(16, 12);
		const run = await engine.runScheduleNow(project.id, "nightly");
		expect(run.trigger).toEqual({
			kind: "schedule",
			scheduleId: "nightly",
			at: at(16, 12),
		});
		expect(run.flowName).toBe("night");
		expect(run.inputs).toEqual({ epic: "42" });
		expect(run.stopAt).toBe(at(17, 7));
		expect(await scheduleFacts()).toMatchObject([
			{ type: "ScheduleFired", payload: { at: at(16, 12), runId: run.id } },
		]);
		await waitForEnd(engine, run.id);
		const [listed] = (await engine.listSchedules(project.id)).schedules;
		expect(listed?.last).toMatchObject({ kind: "fired", runId: run.id });
		// Tonight's start still fires.
		expect(listed?.nextAt).toBe(at(16, 22));
		clock = at(16, 22, 0, 20);
		const facts = await waitForFacts(2);
		expect(facts[1]).toMatchObject({
			type: "ScheduleFired",
			payload: { at: at(16, 22), error: null },
		});
		await waitForEnd(engine, firedRunId(facts[1]));
	});
});
