import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fakeHarness } from "@nightshift/agents/testing";
import { device, event, run } from "@nightshift/db/schema";
import type { Flow, Schedule } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { asc, eq, inArray } from "drizzle-orm";
import {
	defaultRunSettings,
	type RunSettings,
} from "../device-config/settings";
import type { RunLog } from "../log";
import { appendEvent, type EnginePayloads, parseEventRow } from "../log/events";
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
import { createScheduler, SCHEDULE_GRACE_MS } from "./scheduler";

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
		version: 7,
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
		version: 7,
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

	test("a schedule with a time zone fires and stops on that clock, not this computer's", async () => {
		// 22:00 in Tokyo on the 16th is 13:00 UTC; 07:00 there the next day is 22:00 UTC.
		clock = Date.UTC(2026, 9, 16, 12, 59);
		const { engine } = startDaemon();
		const project = await setup(engine, [
			nightly({ stopAt: "07:00", timeZone: "Asia/Tokyo" }),
		]);
		await settle();
		expect((await engine.listSchedules(project.id)).schedules[0]?.nextAt).toBe(
			Date.UTC(2026, 9, 16, 13),
		);

		clock = Date.UTC(2026, 9, 16, 13, 0, 20);
		const [fired] = await waitForFacts(1);
		expect(fired?.payload).toMatchObject({ at: Date.UTC(2026, 9, 16, 13) });
		const run = (await engine.listRuns())[0] as RunSummary;
		expect(run.stopAt).toBe(Date.UTC(2026, 9, 16, 22));
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
		await engine.act(runId, { kind: "stop" });
		clock = at(16, 24, 0, 30);
		const later = await waitForFacts(3);
		expect(later[2]).toMatchObject({
			type: "ScheduleFired",
			payload: { at: at(16, 24), error: null },
		});
		const next = firedRunId(later[2]);
		await engine.act(next, { kind: "stop" });
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

	test("a hold waits for the tick under way, and the ticks during it start nothing", async () => {
		let listed = 0;
		let answer: () => void = () => {};
		const scheduler = createScheduler({
			db: sandbox.db,
			now: () => clock,
			tickMs: TICK_MS,
			log: {} as RunLog,
			projects: () => {
				listed++;
				return new Promise((resolve) => {
					answer = () => resolve([]);
				});
			},
			flows: { schedules: async () => ({ schedules: [] }) } as never,
			startRun: () => Promise.reject(new Error("No run starts here.")),
			runStatus: async () => null,
		});
		const ticking = scheduler.tick();
		await waitFor(async () => listed === 1 || null, {
			label: "the tick lists",
		});
		let held = false;
		const holding = scheduler.hold().then((release) => {
			held = true;
			return release;
		});
		await Bun.sleep(TICK_MS * 2);
		expect(held).toBe(false);

		answer();
		await ticking;
		const release = await holding;
		expect(held).toBe(true);
		await scheduler.tick();
		expect(listed).toBe(1);
		release();
		const next = scheduler.tick();
		await waitFor(async () => listed === 2 || null, {
			label: "the tick after the release lists",
		});
		answer();
		await next;
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

	test("the computer that keeps the Space fires every schedule; the Device a schedule names runs its run", async () => {
		const { engine } = startDaemon();
		await setup(engine, [
			nightly({ id: "elsewhere", device: "hetzner-1" }),
			nightly({ id: "here", device: "test" }),
		]);
		clock = at(16, 22, 1);
		await waitForFacts(2);
		await settle();
		const facts = await scheduleFacts();
		const of = (id: string) =>
			facts.find((f) => f.payload.scheduleId === id)?.payload;
		expect(of("here")).toMatchObject({ error: null });
		expect(of("here")?.runId).toBeString();
		// This computer alone has no Device of that name: the start is refused.
		expect(of("elsewhere")).toMatchObject({
			runId: null,
			error:
				'There is no device named "hetzner-1" in this Space. Choose another device for this schedule.',
		});
		await waitForEnd(engine, of("here")?.runId as string);
	});

	test("picks up an edit of the schedules on the next tick, without a restart", async () => {
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

	test("an hourly schedule skips the night and fires again at 06:00", async () => {
		const { engine } = startDaemon();
		const project = await setup(engine, [nightly({ cron: "0 * * * *" })]);
		clock = at(16, 23, 30);
		expect(await engine.pauseScheduleTonight(project.id, "nightly")).toEqual({
			pausedUntil: at(17, 6),
			nextAt: at(17, 6),
		});
		clock = at(17, 5, 0, 20);
		const [skipped] = await waitForFacts(1);
		expect(skipped).toMatchObject({
			type: "ScheduleSkipped",
			payload: { at: at(17, 5) },
		});
		clock = at(17, 6, 0, 20);
		const facts = await waitForFacts(2);
		expect(facts[1]).toMatchObject({
			type: "ScheduleFired",
			payload: { at: at(17, 6) },
		});
		await waitForEnd(engine, firedRunId(facts[1]));
	});

	test("resume ends the pause: tonight's start fires", async () => {
		const { engine } = startDaemon();
		const project = await setup(engine, [nightly()]);
		clock = at(16, 12);
		await engine.pauseScheduleTonight(project.id, "nightly");
		expect(await engine.resumeScheduleTonight(project.id, "nightly")).toEqual({
			pausedUntil: null,
			nextAt: at(16, 22),
		});
		const [listed] = (await engine.listSchedules(project.id)).schedules;
		expect(listed).toEqual({
			...nightly(),
			nextAt: at(16, 22),
			last: null,
			deliveries: [],
			issues: [],
		});
		clock = at(16, 22, 0, 20);
		const [fired] = await waitForFacts(1);
		expect(fired?.type).toBe("ScheduleFired");
		await waitForEnd(engine, firedRunId(fired));
	});

	test("refuses a schedule that is off, has a webhook or does not exist", async () => {
		const { engine } = startDaemon({ scheduler: false });
		const project = await setup(engine, [
			nightly({ id: "off", enabled: false }),
			{
				id: "hook",
				flow: "night",
				inputs: {},
				enabled: true,
				// biome-ignore lint/suspicious/noTemplateCurlyInString: a secret reference, as a person writes it.
				webhook: { secret: "${HOOK_SECRET}" },
			},
		]);
		await expect(
			engine.pauseScheduleTonight(project.id, "off"),
		).rejects.toMatchObject({
			kind: "invalid",
			message: "This schedule is off. It starts nothing tonight.",
		});
		await expect(
			engine.pauseScheduleTonight(project.id, "hook"),
		).rejects.toMatchObject({ kind: "invalid" });
		await expect(
			engine.pauseScheduleTonight(project.id, "gone"),
		).rejects.toMatchObject({ kind: "not-found" });
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

	test("refuses while an earlier run of the schedule is open", async () => {
		const { engine } = startDaemon({ scheduler: false });
		const project = await setup(engine, [nightly()], gateFlow());
		const run = await engine.runScheduleNow(project.id, "nightly");
		await waitFor(
			async () =>
				(await engine.listRuns()).find((r) => r.id === run.id)?.status ===
				"waiting",
			{ label: "the run to wait at its Gate" },
		);
		await expect(
			engine.runScheduleNow(project.id, "nightly"),
		).rejects.toMatchObject({ kind: "conflict" });
		await engine.act(run.id, { kind: "stop" });
	});

	test("refuses a schedule that does not exist", async () => {
		const { engine } = startDaemon({ scheduler: false });
		const project = await setup(engine, []);
		await expect(
			engine.runScheduleNow(project.id, "gone"),
		).rejects.toMatchObject({ kind: "not-found" });
	});
});
