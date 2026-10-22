import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Command } from "@langchain/langgraph";
import {
	fakeHarness,
	reportingScript,
	usageLimitScript,
} from "@nightshift/agents/testing";
import type { AgentSessionInput } from "@nightshift/agents/types";
import type { WaitNode } from "@nightshift/flows";
import { readTranscriptFile } from "../log/transcripts";
import { deriveRunState, deriveSleep } from "../read/derive-run";
import { deriveSteps } from "../read/derive-steps";
import {
	agent,
	command,
	type Driven,
	drive,
	edge,
	flowOf,
	type Harness,
	MINUTE,
	payloads,
	startRun,
} from "../testing/graph";
import { createSandbox, type Sandbox, waitFor } from "../testing/test-support";
import { DEFAULT_RESUME_PROMPT, STOP_TIME_REASON } from "./context";
import {
	createSleeps,
	pendingWaitOf,
	planWake,
	recordWake,
	type Wake,
} from "./sleep";
import type { Pending, ResumeValue } from "./state";

/**
 * The sleep module end to end, for both kinds of wait: a usage limit of an
 * Agent step (the run policy plans it) and a Wait node's own wait. Plan,
 * persist, interrupt, then the daemon side: `planWake` and `recordWake` as
 * the runner's wake Turn calls them, over the compiled graph. A wake by the
 * timer, a signal, a person's early resume, a wake past the stop time, and
 * a new daemon that restores the timer from the log. The slot, the run cap
 * and the queue are the runner's (`runner.test.ts`). The clock is
 * `ctx.now`, moved by hand.
 */

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

/** A clock the test moves. */
function clock(start = Date.now()) {
	let now = start;
	return {
		now: () => now,
		advance: (minutes: number) => {
			now += minutes * MINUTE;
		},
	};
}

const wait = (
	id: string,
	until: WaitNode["until"],
	extra: Partial<WaitNode> = {},
): WaitNode => ({
	id,
	type: "wait",
	position: { x: 0, y: 0 },
	until,
	...extra,
});

/**
 * The daemon side of the module as the runner's wake Turn uses it:
 * `planWake`, then `recordWake` and the resume into the wait node, driven
 * on a new compile over the same saver (a new daemon). The timers hand a
 * fired run to the same wake. The test reads what the wake sent and what
 * the drive gave.
 */
function daemon(h: Harness, time: { now(): number }) {
	const resumed: ResumeValue[] = [];
	const drives: Promise<Driven>[] = [];
	async function wake(how: Wake): Promise<void> {
		const plan = planWake(
			await h.events(),
			await h.thread.state(),
			how,
			time.now(),
		);
		if (plan.kind !== "wake") return;
		await recordWake(
			{
				log: h.log,
				bus: h.ctx.bus,
				recorders: {
					open: (_runId, stepId, path) => h.ctx.recorder(stepId, path),
				},
			},
			h.runId,
			plan,
			how,
		);
		resumed.push(plan.resume);
		drives.push(drive(h, new Command({ resume: plan.resume }), h.graph()));
	}
	const sleeps = createSleeps({
		now: time.now,
		wake: () => void wake({ early: false }),
	});
	return {
		wake,
		sleeps,
		resumed,
		/** The drive the latest wake started. */
		driven: () => drives[drives.length - 1] as Promise<Driven>,
		drives,
	};
}

const transcriptOf = async (h: Harness, stepId: string) =>
	(
		await readTranscriptFile(
			deriveSteps(await h.events()).find((s) => s.id === stepId)
				?.transcriptPath as string,
		)
	).map((e) => e.event);

describe("the sleep module: an Agent step's usage-limit wait", () => {
	/** A worker that hits the limit once, then passes. */
	function limited(resetAt: number) {
		return fakeHarness((_input: AgentSessionInput, call: number) =>
			call === 0 ? usageLimitScript(resetAt) : reportingScript("pass", "Done"),
		);
	}

	test("plans the wait from the policy, persists it, parks at the wait node, and the timer's wake continues the step", async () => {
		const time = clock();
		const resetAt = time.now() + 30 * MINUTE;
		const h = await startRun(sandbox, flowOf([agent("worker", "Go")]), {
			harness: limited(resetAt),
		});
		h.ctx.now = time.now;
		const first = await drive(h, { inputs: {} });
		const stepId = deriveSteps(await h.events())[0]?.id as string;

		// Persisted: the log, the transcript, the interrupt and the one pending shape.
		expect(first.next).toEqual(["wait__worker"]);
		expect(first.parked).toEqual([
			{
				kind: "wait",
				stepId,
				nodeId: "worker",
				reason: "usage-limit",
				until: resetAt + MINUTE,
				message:
					"Usage limit: You've hit your limit. The step continues a minute after the reset.",
			},
		]);
		expect(payloads(await h.events(), "WaitStarted")).toEqual([
			{
				reason: "usage-limit",
				until: resetAt + MINUTE,
				message:
					"Usage limit: You've hit your limit. The step continues a minute after the reset.",
				since: time.now(),
				// A usage limit is the harness login's on the step's Device.
				deviceId: "test-device",
			},
		]);
		expect((await transcriptOf(h, stepId)).at(-1)).toMatchObject({
			type: "wait",
			reason: "usage-limit",
			until: resetAt + MINUTE,
		});
		expect(first.state.pending).toEqual({
			kind: "wait",
			stepId,
			nodeId: "worker",
			visit: 1,
			reason: "usage-limit",
			until: resetAt + MINUTE,
			message:
				"Usage limit: You've hit your limit. The step continues a minute after the reset.",
			streak: { count: 1, since: time.now() },
			session: {
				harnessSessionId: "fake-session-1",
				prompt: DEFAULT_RESUME_PROMPT,
			},
		});
		expect(deriveRunState(await h.events()).status).toBe("sleeping");

		// A timer that fires before its time wakes nothing.
		const d = daemon(h, time);
		await d.wake({ early: false });
		expect(d.resumed).toEqual([]);
		expect(payloads(await h.events(), "WaitEnded")).toEqual([]);

		// The wake: WaitEnded, the transcript wake, the resume into the wait node.
		time.advance(31);
		await d.wake({ early: false });
		expect(d.resumed).toEqual([{ kind: "wake", early: false }]);
		expect(payloads(await h.events(), "WaitEnded")).toEqual([{ early: false }]);
		const woken = await d.driven();
		expect(woken.state.pending).toBeNull();
		expect(woken.state.ended).toMatchObject({ status: "finished" });
		expect(await h.types()).toEqual([
			"RunStarted",
			"StepStarted",
			"SessionStarted",
			"HarnessSessionAssigned",
			"SessionEnded",
			"WaitStarted",
			"WaitEnded",
			"SessionStarted",
			"HarnessSessionAssigned",
			"SessionEnded",
			"StepEnded",
		]);
		expect((await transcriptOf(h, stepId)).map((e) => e.type)).toContain(
			"wake",
		);
		// The same step and harness session continue after the wake.
		expect(payloads(await h.events(), "SessionStarted")[1]).toMatchObject({
			prompt: DEFAULT_RESUME_PROMPT,
			resumeSessionId: "fake-session-1",
		});
		// A second wake finds no sleeping run and does nothing.
		await d.wake({ early: false });
		expect(d.resumed).toHaveLength(1);
	});

	test("a person's early resume wakes it now with their prompt", async () => {
		const time = clock();
		const h = await startRun(sandbox, flowOf([agent("worker", "Go")]), {
			harness: limited(time.now() + 30 * MINUTE),
		});
		h.ctx.now = time.now;
		await drive(h, { inputs: {} });
		const d = daemon(h, time);
		time.advance(1);
		await d.wake({ early: true, prompt: "Hurry up." });
		expect(d.resumed).toEqual([
			{ kind: "wake", early: true, prompt: "Hurry up." },
		]);
		expect(payloads(await h.events(), "WaitEnded")).toEqual([{ early: true }]);
		await d.driven();
		expect(payloads(await h.events(), "SessionStarted")[1]).toMatchObject({
			prompt: "Hurry up.",
			resumeSessionId: "fake-session-1",
		});
	});

	test("a wait that would pass the stop time is not started: the step ends stopped with why", async () => {
		const time = clock();
		const resetAt = time.now() + 30 * MINUTE;
		const h = await startRun(sandbox, flowOf([agent("worker", "Go")]), {
			harness: limited(resetAt),
		});
		h.ctx.now = time.now;
		const first = await drive(h, { inputs: {}, stopAt: resetAt - 5 * MINUTE });
		expect(first.parked).toEqual([
			{
				kind: "parked",
				stepId: deriveSteps(await h.events())[0]?.id as string,
				nodeId: "worker",
				status: "stopped",
				reason:
					"Usage limit: You've hit your limit. It resets after the stop time, so the run stopped. Resume the run to continue.",
				atStopTime: true,
			},
		]);
		expect(payloads(await h.events(), "WaitStarted")).toEqual([]);
		expect(payloads(await h.events(), "StepEnded")[0]).toMatchObject({
			outcome: "stopped",
		});
	});

	test("a wake past the stop time (Night Shift was not running) ends the step stopped and parks the run", async () => {
		const time = clock();
		const resetAt = time.now() + 30 * MINUTE;
		const harness = limited(resetAt);
		const h = await startRun(sandbox, flowOf([agent("worker", "Go")]), {
			harness,
		});
		h.ctx.now = time.now;
		await drive(h, { inputs: {}, stopAt: resetAt + 10 * MINUTE });
		expect(payloads(await h.events(), "WaitStarted")).toHaveLength(1);
		const d = daemon(h, time);
		time.advance(60);
		await d.wake({ early: false });
		const woken = await d.driven();
		expect(woken.parked).toEqual([
			{
				kind: "parked",
				stepId: deriveSteps(await h.events())[0]?.id as string,
				nodeId: "worker",
				status: "stopped",
				reason: STOP_TIME_REASON,
				atStopTime: true,
			},
		]);
		expect(payloads(await h.events(), "StepEnded")).toEqual([
			{
				outcome: "stopped",
				outputs: { visit: 1, outcome: "stopped" },
				error: null,
			},
		]);
		// The body did not run again, and the park keeps the harness session
		// for a resume.
		expect(harness.calls).toHaveLength(1);
		expect(woken.state.pending).toMatchObject({
			kind: "parked",
			stepId: deriveSteps(await h.events())[0]?.id as string,
			harnessSessionId: "fake-session-1",
		});
	});

	test("planWake: a timer before its time is too soon, an early wake is not, and a run that no longer sleeps wakes nothing", async () => {
		const time = clock();
		const resetAt = time.now() + 30 * MINUTE;
		const h = await startRun(sandbox, flowOf([agent("worker", "Go")]), {
			harness: limited(resetAt),
		});
		h.ctx.now = time.now;
		await drive(h, { inputs: {} });
		const events = await h.events();
		const at = await h.thread.state();
		const stepId = deriveSteps(events)[0]?.id as string;
		expect(planWake(events, at, { early: false }, time.now())).toEqual({
			kind: "too-soon",
			until: resetAt + MINUTE,
		});
		expect(
			planWake(events, at, { early: true, prompt: "Now." }, time.now()),
		).toMatchObject({
			kind: "wake",
			step: { id: stepId },
			resume: { kind: "wake", early: true, prompt: "Now." },
		});
		expect(
			planWake(events, at, { early: true, signal: "go" }, time.now()),
		).toMatchObject({ kind: "wake", resume: { kind: "signal", name: "go" } });
		expect(planWake(events, { kind: "fresh" }, { early: true }, 0)).toEqual({
			kind: "not-sleeping",
		});
		// The log says the run stopped: the thread still sits at its wait.
		expect(
			planWake(
				[
					...events,
					{
						...(events.at(-1) as (typeof events)[number]),
						seq: 10_000,
						type: "RunEnded",
						payload: { status: "stopped", reason: null },
					} as (typeof events)[number],
				],
				at,
				{ early: true },
				time.now(),
			),
		).toEqual({ kind: "not-sleeping" });
	});

	test("a stop while it sleeps, then a resume: the wait node parks the step and the node reopens it with its session", async () => {
		const time = clock();
		const h = await startRun(sandbox, flowOf([agent("worker", "Go")]), {
			harness: limited(time.now() + 30 * MINUTE),
		});
		h.ctx.now = time.now;
		await drive(h, { inputs: {} });
		const stepId = deriveSteps(await h.events())[0]?.id as string;
		// The runner's closeOpenWork, then the engine's RunResumed.
		await h.log.append({
			type: "StepEnded",
			runId: h.runId,
			stepId,
			payload: {
				outcome: "stopped",
				outputs: { outcome: "stopped" },
				error: null,
			},
		});
		await h.log.append({
			type: "RunEnded",
			runId: h.runId,
			payload: { status: "stopped", reason: null },
		});
		await h.log.append({
			type: "RunResumed",
			runId: h.runId,
			payload: { nodeId: "worker", stepId, prompt: "Go on.", by: "person" },
		});
		const d = daemon(h, time);
		// A stopped run does not sleep: the wake does nothing.
		await d.wake({ early: true });
		expect(d.resumed).toEqual([]);
		const resumed = await drive(
			h,
			new Command({ resume: { kind: "resume", prompt: "Go on." } }),
			h.graph(),
		);
		expect(resumed.state.ended).toMatchObject({ status: "finished" });
		expect(payloads(await h.events(), "StepReopened")).toEqual([
			{ prompt: "Go on." },
		]);
		expect(payloads(await h.events(), "SessionStarted")[1]).toMatchObject({
			prompt: "Go on.",
			resumeSessionId: "fake-session-1",
		});
	});

	test("a new daemon restores the timer from the log, and the wake fires at once when the time has passed", async () => {
		const time = clock();
		const h = await startRun(sandbox, flowOf([agent("worker", "Go")]), {
			harness: limited(time.now() + 30 * MINUTE),
		});
		h.ctx.now = time.now;
		await drive(h, { inputs: {} });
		time.advance(45);
		const next = daemon(h, time);
		next.sleeps.restore(h.runId, await h.events());
		await waitFor(() => next.resumed.length === 1);
		expect(next.resumed).toEqual([{ kind: "wake", early: false }]);
		expect(payloads(await h.events(), "WaitEnded")).toEqual([{ early: false }]);
		const woken = await next.driven();
		expect(woken.state.ended).toMatchObject({ status: "finished" });
		// A run that stopped meanwhile gets no timer.
		const other = daemon(h, time);
		other.sleeps.restore(h.runId, await h.events());
		await Bun.sleep(10);
		expect(other.resumed).toEqual([]);
	});
});

describe("the sleep module: a Wait node's own wait", () => {
	const timedFlow = (minutes: number, extra: Partial<WaitNode> = {}) =>
		flowOf(
			[
				wait("pause", { kind: "duration", minutes }, extra),
				command("after", "echo waited {{pause.waited_minutes}}"),
			],
			[edge("e1", "pause", "done", "after")],
		);
	const silent = fakeHarness();

	test("plans from the node's until, persists it with no session, and the timer's wake ends it done", async () => {
		const time = clock();
		const h = await startRun(sandbox, timedFlow(15), { harness: silent });
		h.ctx.now = time.now;
		const first = await drive(h, { inputs: {} });
		const stepId = deriveSteps(await h.events())[0]?.id as string;
		expect(first.next).toEqual(["wait__pause"]);
		expect(first.parked).toEqual([
			{
				kind: "wait",
				stepId,
				nodeId: "pause",
				reason: "duration",
				until: time.now() + 15 * MINUTE,
				message: "Waits 15 min.",
			},
		]);
		expect(payloads(await h.events(), "WaitStarted")).toEqual([
			{
				reason: "duration",
				until: time.now() + 15 * MINUTE,
				message: "Waits 15 min.",
				since: time.now(),
			},
		]);
		expect(first.state.pending).toEqual({
			kind: "wait",
			stepId,
			nodeId: "pause",
			visit: 1,
			reason: "duration",
			until: time.now() + 15 * MINUTE,
			message: "Waits 15 min.",
			streak: { count: 1, since: time.now() },
			session: null,
		});
		expect((await transcriptOf(h, stepId)).at(-1)).toMatchObject({
			type: "wait",
			reason: "duration",
		});
		// The step is open, and the log alone says the run sleeps and until when.
		expect(deriveSteps(await h.events())[0]?.endedAt).toBeNull();
		expect(deriveRunState(await h.events()).status).toBe("sleeping");
		expect(deriveSleep(await h.events())).toMatchObject({
			stepId,
			reason: "duration",
			until: time.now() + 15 * MINUTE,
			signal: null,
		});

		const d = daemon(h, time);
		time.advance(15);
		await d.wake({ early: false });
		expect(d.resumed).toEqual([{ kind: "wake", early: false }]);
		expect(payloads(await h.events(), "WaitEnded")).toEqual([{ early: false }]);
		expect((await transcriptOf(h, stepId)).map((e) => e.type)).toEqual([
			"wait",
			"wake",
		]);
		const woken = await d.driven();
		expect(woken.state.ended).toMatchObject({ status: "finished" });
		expect(payloads(await h.events(), "StepEnded")[0]).toEqual({
			outcome: "done",
			outputs: { outcome: "done", waited_minutes: 15, visit: 1 },
			error: null,
		});
		expect(woken.state.nodes.after?.log_tail).toContain("waited 15");
	});

	test("a person's early resume ends a duration wait done with the minutes waited", async () => {
		const time = clock();
		const h = await startRun(sandbox, timedFlow(60), { harness: silent });
		h.ctx.now = time.now;
		await drive(h, { inputs: {} });
		const d = daemon(h, time);
		time.advance(10);
		await d.wake({ early: true });
		expect(d.resumed).toEqual([{ kind: "wake", early: true }]);
		expect(payloads(await h.events(), "WaitEnded")).toEqual([{ early: true }]);
		await d.driven();
		expect(payloads(await h.events(), "StepEnded")[0]).toMatchObject({
			outcome: "done",
			outputs: { waited_minutes: 10 },
		});
	});

	test("a signal: no wake time, a wake that is not the signal sleeps on (the streak grows), the signal ends it done", async () => {
		const time = clock();
		const h = await startRun(
			sandbox,
			flowOf([
				wait(
					"gate",
					{ kind: "signal", name: "deployed" },
					{ timeoutMinutes: 60 },
				),
			]),
			{ harness: silent },
		);
		h.ctx.now = time.now;
		const first = await drive(h, { inputs: {} });
		const stepId = deriveSteps(await h.events())[0]?.id as string;
		// The deadline is the only wake time: the sleep module cut it in.
		expect(first.parked[0]).toMatchObject({
			kind: "wait",
			reason: "signal",
			until: time.now() + 60 * MINUTE,
		});
		expect(payloads(await h.events(), "WaitStarted")[0]).toMatchObject({
			signal: "deployed",
			since: time.now(),
		});

		const d = daemon(h, time);
		time.advance(5);
		await d.wake({ early: true });
		const again = await d.driven();
		expect(again.parked[0]).toMatchObject({
			kind: "wait",
			reason: "signal",
			until: time.now() + 55 * MINUTE,
		});
		expect(again.state.pending).toMatchObject({
			streak: { count: 2, since: time.now() - 5 * MINUTE },
			session: null,
		});
		expect(again.state.pending).not.toHaveProperty("signal");

		time.advance(5);
		await d.wake({ early: true, signal: "deployed" });
		expect(d.resumed[1]).toEqual({ kind: "signal", name: "deployed" });
		expect(payloads(await h.events(), "WaitEnded")).toEqual([
			{ early: true },
			{ early: true, signal: "deployed" },
		]);
		expect(
			(await transcriptOf(h, stepId)).filter((e) => e.type === "wake"),
		).toEqual([{ type: "wake" }, { type: "wake", signal: "deployed" }]);
		const done = await d.driven();
		expect(done.state.ended).toMatchObject({
			status: "finished",
			outcome: "done",
		});
		expect(payloads(await h.events(), "StepEnded")[0]).toMatchObject({
			outcome: "done",
			outputs: { waited_minutes: 10 },
		});
	});

	test("a wake past the stop time ends the Wait step stopped with the minutes waited", async () => {
		const time = clock();
		const h = await startRun(sandbox, timedFlow(120), { harness: silent });
		h.ctx.now = time.now;
		await drive(h, { inputs: {}, stopAt: time.now() + 60 * MINUTE });
		const d = daemon(h, time);
		time.advance(120);
		await d.wake({ early: false });
		const woken = await d.driven();
		expect(woken.parked).toEqual([
			{
				kind: "parked",
				stepId: deriveSteps(await h.events())[0]?.id as string,
				nodeId: "pause",
				status: "stopped",
				reason: STOP_TIME_REASON,
				atStopTime: true,
			},
		]);
		expect(payloads(await h.events(), "StepEnded")).toEqual([
			{
				outcome: "stopped",
				outputs: { outcome: "stopped", waited_minutes: 120, visit: 1 },
				error: null,
			},
		]);
	});

	test("a new daemon restores the Wait node's timer from the log", async () => {
		const time = clock();
		const h = await startRun(sandbox, timedFlow(15), { harness: silent });
		h.ctx.now = time.now;
		await drive(h, { inputs: {} });
		time.advance(20);
		const next = daemon(h, time);
		next.sleeps.restore(h.runId, await h.events());
		await waitFor(() => next.resumed.length === 1);
		const woken = await next.driven();
		expect(woken.state.ended).toMatchObject({ status: "finished" });
		expect(payloads(await h.events(), "StepEnded")[0]).toMatchObject({
			outcome: "done",
			outputs: { waited_minutes: 20 },
		});
	});

	test("a stop while it sleeps, then a resume, starts a new visit", async () => {
		const time = clock();
		const h = await startRun(sandbox, timedFlow(15), { harness: silent });
		h.ctx.now = time.now;
		await drive(h, { inputs: {} });
		const stepId = deriveSteps(await h.events())[0]?.id as string;
		await h.log.append({
			type: "StepEnded",
			runId: h.runId,
			stepId,
			payload: {
				outcome: "stopped",
				outputs: { outcome: "stopped" },
				error: null,
			},
		});
		await h.log.append({
			type: "RunEnded",
			runId: h.runId,
			payload: { status: "stopped", reason: null },
		});
		await h.log.append({
			type: "RunResumed",
			runId: h.runId,
			payload: { nodeId: "pause", stepId, prompt: null, by: "person" },
		});
		const resumed = await drive(
			h,
			new Command({ resume: { kind: "resume" } }),
			h.graph(),
		);
		expect(resumed.parked[0]).toMatchObject({ kind: "wait", nodeId: "pause" });
		expect(
			deriveSteps(await h.events()).map((s) => [s.visit, s.outcome]),
		).toEqual([
			[1, "stopped"],
			[2, null],
		]);
	});
});

describe("pendingWaitOf: the one reader of a pending wait", () => {
	const base = {
		kind: "wait" as const,
		stepId: "s1",
		nodeId: "n",
		visit: 1,
		until: 2_000,
		message: "Waits.",
		streak: { count: 1, since: 1_000 },
	};

	test("reads today's shape as it is, and only this node's", () => {
		const pending: Pending = { ...base, reason: "usage-limit", session: null };
		expect(pendingWaitOf(pending)).toBe(pending);
		expect(pendingWaitOf(pending, "n")).toBe(pending);
		expect(pendingWaitOf(pending, "other")).toBeNull();
		expect(pendingWaitOf(null)).toBeNull();
		expect(
			pendingWaitOf({
				kind: "parked",
				stepId: null,
				nodeId: "n",
				visit: 0,
				harnessSessionId: null,
				prompt: null,
				status: "stopped",
				reason: null,
			}),
		).toBeNull();
	});

	test("reads a checkpoint from before the module: the flat continuation becomes `session`, resetAt goes", () => {
		const legacyAgent = {
			...base,
			reason: "usage-limit",
			harnessSessionId: "h1",
			prompt: "Carry on.",
			resetAt: 1_500,
		} as unknown as Pending;
		expect(pendingWaitOf(legacyAgent)).toEqual({
			...base,
			reason: "usage-limit",
			session: { harnessSessionId: "h1", prompt: "Carry on." },
		});
		const legacyWaitNode = {
			...base,
			reason: "duration",
			harnessSessionId: null,
			prompt: "",
			resetAt: null,
		} as unknown as Pending;
		expect(pendingWaitOf(legacyWaitNode)).toEqual({
			...base,
			reason: "duration",
			session: null,
		});
	});
});
