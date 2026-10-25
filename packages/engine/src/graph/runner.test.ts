import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { run } from "@nightshift/db/schema";
import type { Flow } from "@nightshift/flows";
import { eq } from "drizzle-orm";
import { defaultRunSettings } from "../device-config/settings";
import { getRunRow } from "../log/run-row";
import { deriveOpenGate, deriveRunState } from "../read/derive-run";
import { deriveSteps } from "../read/derive-steps";
import {
	agent,
	command,
	edge,
	flowOf,
	type Harness,
	startRun,
	testRunner,
} from "../testing/graph";
import {
	createSandbox,
	type Sandbox,
	scriptedHarness,
	waitFor,
} from "../testing/test-support";
import {
	RELEASED,
	type Runner,
	type RunnerDeps,
	WALKED_ELSEWHERE_NOW,
} from "./runner";
import { openThread } from "./thread";

/**
 * The runner's one entry, `take(runId, intent)`, and `hold`, on a real
 * runner over the sandbox (`testRunner`): the per-run queue, the run cap
 * and its queue, the Turns that take a drive, and the handover. Each test
 * names the invariant of the runner's header it pins.
 */

let sandbox: Sandbox;
let runners: Runner[];
beforeEach(async () => {
	sandbox = await createSandbox();
	runners = [];
});
afterEach(async () => {
	for (const runner of runners) await runner.release();
	await sandbox.cleanup();
});

const worker = () =>
	flowOf(
		[agent("worker", "Build it"), command("check", "true")],
		[edge("e1", "worker", "pass", "check")],
	);

const gate = (id: string) => ({
	id,
	type: "decision" as const,
	position: { x: 0, y: 0 },
	prompt: "Ship it?",
	options: [{ name: "yes" }, { name: "no" }],
	by: "person" as const,
});

/** A run of `flow`, and a runner over it with a run cap of `cap`. */
async function setup(flow: Flow, cap = 2, overrides: Partial<RunnerDeps> = {}) {
	const scripted = scriptedHarness();
	const h = await startRun(sandbox, flow, { harness: scripted.harness });
	const runner = testRunner(h, {
		settings: () => ({ ...defaultRunSettings(), maxConcurrentRuns: cap }),
		...overrides,
	});
	runners.push(runner);
	return { h, runner, sessions: scripted.sessions };
}

/** Another run on the same database, for the same runner. */
async function another(flow: Flow): Promise<string> {
	return (await startRun(sandbox, flow)).runId;
}

/** The start's Turn of a run whose row and `RunStarted` the harness wrote. */
const start = (runner: Runner, runId: string, before?: Promise<void>) =>
	runner.take(runId, {
		kind: "start",
		prepare: async () => {
			await before;
			return {
				row: await getRunRow(sandbox.db, runId),
				inputs: {},
				stopAt: null,
			};
		},
	});

const statusOf = async (h: Harness, runId = h.runId) =>
	deriveRunState(await h.log.events(runId)).status;

/** A promise the test settles by hand. */
function latch() {
	let open = () => {};
	const opened = new Promise<void>((resolve) => {
		open = resolve;
	});
	return { opened, open };
}

describe("take: one Turn at a time per run", () => {
	test("two starts at once with a cap of one: one is refused (I2)", async () => {
		const { h, runner } = await setup(worker(), 1);
		const other = await another(worker());
		const [a, b] = await Promise.allSettled([
			start(runner, h.runId),
			start(runner, other),
		]);
		expect(a).toEqual({ status: "fulfilled", value: { kind: "driving" } });
		expect(b.status).toBe("rejected");
		expect(String((b as PromiseRejectedResult).reason)).toContain(
			"The run cap is reached: 1 of 1",
		);
		expect(runner.isActive(other)).toBe(false);
	});

	test("a stop during a start's Turn waits for it, then stops the new walk (I1, I3)", async () => {
		const { h, runner, sessions } = await setup(worker());
		const prepared = latch();
		const starting = start(runner, h.runId, prepared.opened);
		const stopping = runner.take(h.runId, { kind: "stop" });
		await Bun.sleep(20);
		expect(runner.isActive(h.runId)).toBe(true);
		prepared.open();
		expect(await starting).toEqual({ kind: "driving" });
		expect(await stopping).toEqual({ kind: "halted" });
		expect(await statusOf(h)).toBe("stopped");
		expect(runner.isActive(h.runId)).toBe(false);
		const session = sessions[0];
		if (session) expect(session.input.signal.aborted).toBe(true);
	});

	test("a stop right after a person's resume stops the walk the resume began", async () => {
		const { h, runner, sessions } = await setup(worker());
		await start(runner, h.runId);
		await waitFor(() => sessions[0]);
		await runner.take(h.runId, { kind: "stop" });
		const [resumed, stopped] = await Promise.all([
			runner.take(h.runId, { kind: "resume", by: "person" }),
			runner.take(h.runId, { kind: "stop" }),
		]);
		expect(resumed).toEqual({ kind: "driving" });
		expect(stopped).toEqual({ kind: "halted" });
		expect(await statusOf(h)).toBe("stopped");
		expect(
			(await h.events()).filter((e) => e.type === "StopRequested"),
		).toHaveLength(2);
	});

	test("a take inside a Turn of the same run throws; one of another run goes (I11)", async () => {
		const { h, runner } = await setup(worker());
		const other = await another(worker());
		await expect(
			runner.hold(h.runId, () => runner.take(h.runId, { kind: "stop" })),
		).rejects.toThrow("cannot wait for another Turn of the same run");
		await expect(
			runner.hold(h.runId, () => runner.take(other, { kind: "stop" })),
		).resolves.toEqual({ kind: "unchanged" });
	});

	test("a Turn on a run another Device walks now is refused; the overdue check leaves it (I9)", async () => {
		const { h, runner } = await setup(worker());
		await sandbox.db
			.update(run)
			.set({ walkerId: "another-device" })
			.where(eq(run.id, h.runId));
		await expect(runner.take(h.runId, { kind: "stop" })).rejects.toThrow(
			WALKED_ELSEWHERE_NOW,
		);
		await expect(runner.hold(h.runId, async () => {})).rejects.toThrow(
			WALKED_ELSEWHERE_NOW,
		);
		expect(await runner.take(h.runId, { kind: "overdue", graceMs: 0 })).toEqual(
			{ kind: "unchanged" },
		);
	});
});

describe("take: the run cap", () => {
	test("an answer on a full cap is refused and the Gate stays open; with a slot, it returns once the Gate's step ended", async () => {
		const { h, runner, sessions } = await setup(flowOf([gate("approve")]), 1);
		await start(runner, h.runId);
		await waitFor(async () => (await statusOf(h)) === "waiting");
		const busy = await another(worker());
		await start(runner, busy);
		await waitFor(() => sessions[0]);
		const stepId = deriveOpenGate(await h.events())?.stepId as string;
		const answer = {
			kind: "answer" as const,
			stepId,
			choice: "yes",
			note: "",
		};

		await expect(runner.take(h.runId, answer)).rejects.toThrow("run cap");
		expect(deriveOpenGate(await h.events())?.stepId).toBe(stepId);

		await runner.take(busy, { kind: "stop" });
		expect(await runner.take(h.runId, answer)).toEqual({ kind: "driving" });
		const gateStep = deriveSteps(await h.events()).find((s) => s.id === stepId);
		expect(gateStep?.endedAt).not.toBeNull();
		expect(deriveOpenGate(await h.events())).toBeNull();
	});

	test("Turns queued on a full cap retry in order, each once, when a slot frees (I10)", async () => {
		const { h, runner, sessions } = await setup(worker(), 1);
		const first = await another(worker());
		const second = await another(worker());
		for (const runId of [first, second]) {
			await start(runner, runId);
			await waitFor(() => sessions.length > 0);
			await runner.take(runId, { kind: "stop" });
		}
		await start(runner, h.runId);
		const retried: string[] = [];
		for (const runId of [first, second, first]) {
			expect(
				await runner.take(
					runId,
					{ kind: "resume", by: "daemon" },
					{ whenFull: "queue", retry: () => retried.push(runId) },
				),
			).toEqual({ kind: "queued" });
		}
		await runner.take(h.runId, { kind: "stop" });
		expect(retried).toEqual([first, second]);
	});

	test("a daemon resume queued without its own retry goes on by itself when a slot frees", async () => {
		const { h, runner, sessions } = await setup(worker(), 1);
		const queued = await another(worker());
		await start(runner, queued);
		await waitFor(() => sessions[0]);
		await runner.take(queued, { kind: "stop" });
		await start(runner, h.runId);
		await waitFor(() => sessions[1]);
		expect(
			await runner.take(
				queued,
				{ kind: "resume", by: "daemon" },
				{ whenFull: "queue" },
			),
		).toEqual({ kind: "queued" });
		await runner.take(h.runId, { kind: "stop" });
		await waitFor(() => runner.isActive(queued));
		expect(
			(await h.log.events(queued)).filter((e) => e.type === "RunResumed"),
		).toHaveLength(1);
	});
});

describe("take: a drive's time and a thread that cannot move", () => {
	test("overdue: within its budget the step goes on; past budget plus grace it ends as its timer would", async () => {
		let now = Date.now();
		const { h, runner, sessions } = await setup(
			flowOf([agent("worker", "Build it", { timeoutMinutes: 60 })]),
			2,
			{ now: () => now },
		);
		await start(runner, h.runId);
		await waitFor(() => sessions[0]);
		const minute = h.deps.minuteMs;
		now += 61 * minute;
		expect(
			await runner.take(h.runId, { kind: "overdue", graceMs: minute }),
		).toEqual({ kind: "unchanged" });
		now += minute;
		expect(
			await runner.take(h.runId, { kind: "overdue", graceMs: minute }),
		).toEqual({ kind: "halted" });
		expect(sessions[0]?.input.signal.aborted).toBe(true);
		expect(await statusOf(h)).toBe("failed");
		expect(runner.isActive(h.runId)).toBe(false);
	});

	test("the sweep: a run whose Turn is slow holds back only its own check, not another run's", async () => {
		let now = Date.now();
		const { h, runner, sessions } = await setup(worker(), 2, {
			now: () => now,
			overdueSweepMs: 10,
		});
		await start(runner, h.runId);
		await waitFor(() => sessions[0]);
		// A Turn of the first run that does not end: its checks wait behind it.
		const slow = latch();
		let held = false;
		const holding = runner.hold(h.runId, async () => {
			held = true;
			await slow.opened;
		});
		await waitFor(() => held);
		const late = await another(
			flowOf([agent("worker", "Build it", { timeoutMinutes: 60 })]),
		);
		await start(runner, late);
		await waitFor(() => sessions[1]);
		now += 62 * h.deps.minuteMs;

		await waitFor(async () => (await statusOf(h, late)) === "failed", {
			label: "the sweep to end the late run",
		});
		expect(sessions[1]?.input.signal.aborted).toBe(true);
		expect(await statusOf(h)).toBe("running");
		slow.open();
		await holding;
	});

	test("a rerun whose thread cannot move ends the run failed, so the log does not say it runs", async () => {
		const { h, runner, sessions } = await setup(worker(), 2, {
			openThread: (row, deps) => ({
				...openThread(row, deps),
				clearTasks: async () => {
					throw new Error("the checkpoint is gone");
				},
			}),
		});
		await start(runner, h.runId);
		await waitFor(() => sessions[0]);
		await runner.take(h.runId, { kind: "stop" });
		await expect(
			runner.take(h.runId, { kind: "rerun", by: "person", nodeId: "worker" }),
		).rejects.toThrow("the checkpoint is gone");
		const events = await h.events();
		expect(events.at(-2)).toMatchObject({
			type: "RunResumed",
			payload: { action: "rerun" },
		});
		expect(events.at(-1)).toMatchObject({
			type: "RunEnded",
			payload: {
				status: "failed",
				reason: "The run could not start again: the checkpoint is gone",
			},
		});
		expect(runner.isActive(h.runId)).toBe(false);
	});
});

describe("an ended run keeps only the checkpoints a re-entry reads", () => {
	/** The run's checkpoints per namespace: "" for the root. */
	async function checkpoints(runId: string): Promise<Record<string, number>> {
		const result = await sandbox.db.$client.execute({
			sql: "SELECT checkpoint_ns AS ns, count(*) AS n FROM lg_checkpoint WHERE thread_id = ? GROUP BY checkpoint_ns",
			args: [runId],
		});
		return Object.fromEntries(
			result.rows.map((row) => [String(row.ns), Number(row.n)]),
		);
	}

	test("a failed run keeps its latest checkpoint, and a resume goes on from it", async () => {
		const { h, runner, sessions } = await setup(worker());
		await start(runner, h.runId);
		(await waitFor(() => sessions[0])).fail("The harness broke.");
		await waitFor(async () => (await statusOf(h)) === "failed");
		await waitFor(() => !runner.isActive(h.runId));
		expect(await checkpoints(h.runId)).toEqual({ "": 1 });

		await runner.take(h.runId, { kind: "resume", by: "person" });
		const resumed = await waitFor(() => sessions[1]);
		expect(resumed.input.resumeSessionId).toBe("harness-0");
		resumed.emit({ type: "report", outcome: "pass", summary: "Done." });
		resumed.finish();
		await waitFor(async () => (await statusOf(h)) === "finished");
		expect(
			deriveSteps(await h.events()).map((s) => [s.nodeId, s.outcome]),
		).toEqual([
			["worker", "pass"],
			["check", "pass"],
		]);
	});

	test("a run stopped at a Gate inside a Call keeps the body's namespace: a resume asks again inside it, and runs nothing twice", async () => {
		const review = flowOf(
			[
				{
					id: "first",
					type: "decision",
					position: { x: 0, y: 0 },
					prompt: "",
					options: [{ name: "go", when: "true" }],
					by: "rule",
				},
				gate("approve"),
			],
			[edge("r1", "first", "go", "approve")],
		);
		const call = {
			id: "call",
			type: "call" as const,
			position: { x: 0, y: 0 },
			flow: "review",
			inputs: {},
		};
		const h = await startRun(sandbox, flowOf([call]), {
			flows: { review },
		});
		const runner = testRunner(h);
		runners.push(runner);
		await start(runner, h.runId);
		await waitFor(async () => (await statusOf(h)) === "waiting");
		const before = await checkpoints(h.runId);
		expect(before[""]).toBeGreaterThan(1);

		await runner.take(h.runId, { kind: "stop" });
		const kept = await checkpoints(h.runId);
		expect(kept[""]).toBe(1);
		const bodies = Object.keys(kept).filter((ns) => ns !== "");
		expect(bodies).toHaveLength(1);
		expect(bodies[0]).toStartWith("call:");

		await runner.take(h.runId, { kind: "resume", by: "person" });
		await waitFor(async () => (await statusOf(h)) === "waiting");
		const gateStep = deriveOpenGate(await h.events())?.stepId as string;
		await runner.take(h.runId, {
			kind: "answer",
			stepId: gateStep,
			choice: "yes",
			note: "",
		});
		await waitFor(async () => (await statusOf(h)) === "finished");
		const steps = deriveSteps(await h.events());
		expect(steps.filter((s) => s.nodeId === "first")).toHaveLength(1);
		expect(steps.map((s) => [s.nodeId, s.visit, s.outcome])).toEqual([
			["call", 1, "pass"],
			["first", 1, "go"],
			["approve", 1, "stopped"],
			["approve", 2, "yes"],
		]);
		expect(await checkpoints(h.runId)).toEqual({ "": 1 });
	});
});

describe("release: the handover to a new engine (I7)", () => {
	test("new Turns and queued ones are refused, the Turn in flight finishes, and the drive writes nothing more", async () => {
		const hung = scriptedHarness({ hang: true });
		const h = await startRun(sandbox, worker(), { harness: hung.harness });
		const runner = testRunner(h);
		await start(runner, h.runId);
		const session = await waitFor(() => hung.sessions[0]);
		const inFlight = latch();
		let held = false;
		const holding = runner.hold(h.runId, async () => {
			held = true;
			await inFlight.opened;
			return "done";
		});
		await waitFor(() => held);
		const queued = runner.take(h.runId, { kind: "stop" });

		const releasing = runner.release();
		await expect(runner.take(h.runId, { kind: "stop" })).rejects.toThrow(
			RELEASED,
		);
		await expect(runner.hold(h.runId, async () => {})).rejects.toThrow(
			RELEASED,
		);
		inFlight.open();
		expect(await holding).toBe("done");
		await expect(queued).rejects.toThrow(RELEASED);
		await releasing;
		expect(session.input.signal.aborted).toBe(true);
		expect(runner.isActive(h.runId)).toBe(false);

		const before = (await h.events()).length;
		session.emit({ type: "report", outcome: "pass", summary: "Too late." });
		session.finish();
		await Bun.sleep(50);
		// The log is left as it is: the next engine's recovery takes it from here.
		expect((await h.events()).length).toBe(before);
		expect(await statusOf(h)).toBe("running");
	});
});
