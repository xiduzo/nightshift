import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Command } from "@langchain/langgraph";
import type { GateChoice } from "../log/events";
import { readTranscriptFile } from "../log/transcripts";
import { deriveOpenGate } from "../read/derive-run";
import { deriveSteps } from "../read/derive-steps";
import {
	command,
	drive,
	flowOf,
	type Harness,
	held,
	payloads,
	startRun,
} from "../testing/graph";
import {
	createSandbox,
	type Sandbox,
	TEST_DEVICE_ID,
} from "../testing/test-support";

/**
 * The Gate node on the compiled graph with a real run log and a
 * checkpoint saver. The event log and the transcript are compared with what the
 * engine writes today (engine.test.ts "gates"): `GateOpened` and `gate-open`
 * when the Gate opens, `StepEnded` with the choice and `gate-resolved` on
 * the answer. The runner's part (`StepEnded stopped`, `RunEnded`,
 * `RunResumed`) is appended by hand where a test needs it.
 */

const gate = (id: string, question: string, choices: GateChoice[]) => ({
	id,
	type: "decision" as const,
	position: { x: 0, y: 0 },
	prompt: question,
	options: choices,
	by: "person" as const,
});

/** gate (approve → ship; reject → nothing). */
const gateFlow = () =>
	flowOf({
		inputs: [{ name: "task" }],
		start: "gate",
		nodes: [
			gate("gate", "Ship {{task}}?", [
				{ name: "approve", description: "Looks good" },
				{ name: "reject" },
			]),
			command("ship", 'echo "shipped: {{gate.note}}"'),
		],
		edges: [{ id: "e1", from: "gate", outcome: "approve", to: "ship" }],
	});

const CHOICES = [
	{ name: "approve", description: "Looks good" },
	{ name: "reject" },
];

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

/** What the runner and the engine append when a person stops a run at an open Gate and resumes it. */
async function stopAndResume(h: Harness, stepId: string, visit: number) {
	await h.log.append({ type: "StopRequested", runId: h.runId, payload: {} });
	await h.log.append({
		type: "StepEnded",
		runId: h.runId,
		stepId,
		payload: {
			outcome: "stopped",
			outputs: { outcome: "stopped", note: "", visit },
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
		payload: { nodeId: "gate", stepId: null, prompt: null, by: "person" },
	});
}

describe("the Gate node", () => {
	test("opens the Gate, interrupts, and the answer ends the step with the choice and takes its edge", async () => {
		const h = await startRun(sandbox, gateFlow());
		const first = await drive(h, { inputs: { task: "the thing" } });
		const [gateStep] = deriveSteps(await h.events());
		const stepId = gateStep?.id as string;
		// The node opened the Gate and committed it; its ask node interrupts.
		expect(first.next).toEqual(["ask__gate"]);
		expect(first.parked).toEqual([
			{
				kind: "gate",
				stepId,
				nodeId: "gate",
				question: "Ship the thing?",
				choices: CHOICES,
			},
		]);
		// The visit commits on the answer; the open Gate is in the checkpoint.
		expect(first.state.visits).toEqual({});
		expect(held(first.state)).toEqual({
			kind: "gate",
			stepId,
			nodeId: "gate",
			visit: 1,
			question: "Ship the thing?",
			choices: CHOICES,
		});
		expect(first.state.ended).toBeNull();

		expect(await h.types()).toEqual([
			"RunStarted",
			"StepStarted",
			"GateOpened",
		]);
		const logged = await h.events();
		expect(payloads(logged, "StepStarted")).toEqual([
			{
				nodeId: "gate",
				nodeType: "decision",
				visit: 1,
				transcriptPath: gateStep?.transcriptPath as string,
				logPath: null,
				scope: null,
				deviceId: TEST_DEVICE_ID,
			},
		]);
		expect(payloads(logged, "GateOpened")).toEqual([
			{ question: "Ship the thing?", choices: CHOICES },
		]);
		expect(logged.find((e) => e.type === "GateOpened")?.stepId).toBe(stepId);
		expect(gateStep).toMatchObject({ outcome: null, endedAt: null });
		expect(deriveOpenGate(logged)).toMatchObject({
			stepId,
			nodeId: "gate",
			visit: 1,
			question: "Ship the thing?",
			choices: CHOICES,
		});
		expect(
			(await readTranscriptFile(gateStep?.transcriptPath as string)).map(
				(e) => e.event,
			),
		).toEqual([
			{ type: "gate-open", question: "Ship the thing?", choices: CHOICES },
		]);
		expect(first.events).toEqual([
			{
				type: "step-started",
				stepId,
				nodeId: "gate",
				visit: 1,
				reopened: false,
			},
			{
				type: "transcript",
				entry: expect.objectContaining({
					stepId,
					sessionId: null,
					event: {
						type: "gate-open",
						question: "Ship the thing?",
						choices: CHOICES,
					},
				}),
			},
		]);

		// The engine validated the choice; the answer resumes the thread on a
		// new compile over the same saver.
		const second = await drive(
			h,
			new Command({
				resume: {
					kind: "gate",
					choice: "approve",
					note: "LGTM, merge after CI.",
				},
			}),
			h.graph(),
		);
		expect(second.parked).toEqual([]);
		expect(second.state.ended?.nodeId).toBe("ship");
		expect(second.state.visits).toEqual({ gate: 1, ship: 1 });
		expect(second.state.nodes.gate).toEqual({
			outcome: "approve",
			note: "LGTM, merge after CI.",
			visit: 1,
		});
		expect(second.state.nodes.ship).toMatchObject({
			log_tail: "shipped: LGTM, merge after CI.",
		});
		expect(await h.types()).toEqual([
			"RunStarted",
			"StepStarted",
			"GateOpened",
			"StepEnded",
			"EdgeTaken",
			"StepStarted",
			"StepEnded",
		]);
		const after = await h.events();
		expect(payloads(after, "StepEnded")[0]).toEqual({
			outcome: "approve",
			outputs: { outcome: "approve", note: "LGTM, merge after CI.", visit: 1 },
			error: null,
		});
		expect(after.find((e) => e.type === "StepEnded")?.stepId).toBe(stepId);
		expect(payloads(after, "EdgeTaken")).toEqual([
			{
				edgeId: "e1",
				from: "gate",
				to: "ship",
				outcome: "approve",
				scope: null,
			},
		]);
		expect(deriveOpenGate(after)).toBeNull();
		expect(
			(await readTranscriptFile(gateStep?.transcriptPath as string)).map(
				(e) => e.event,
			),
		).toEqual([
			{ type: "gate-open", question: "Ship the thing?", choices: CHOICES },
			{
				type: "gate-resolved",
				choice: "approve",
				note: "LGTM, merge after CI.",
			},
		]);
		expect(second.events.filter((e) => e.type === "step-ended")[0]).toEqual({
			type: "step-ended",
			stepId,
			nodeId: "gate",
			visit: 1,
			outcome: "approve",
		});
	});

	test("an option's colour goes with its choice: the log, the checkpoint and the transcript", async () => {
		const choices: GateChoice[] = [
			{ name: "ready", description: "Ship it", color: "green" },
			{ name: "revise" },
		];
		const h = await startRun(
			sandbox,
			flowOf({
				start: "gate",
				nodes: [gate("gate", "Ready?", choices)],
				edges: [],
			}),
		);
		const first = await drive(h, {});
		const [gateStep] = deriveSteps(await h.events());
		expect(payloads(await h.events(), "GateOpened")).toEqual([
			{ question: "Ready?", choices },
		]);
		expect(held(first.state)).toMatchObject({ choices });
		expect(
			(await readTranscriptFile(gateStep?.transcriptPath as string)).map(
				(e) => e.event,
			),
		).toEqual([{ type: "gate-open", question: "Ready?", choices }]);
	});

	test("a Gate marked for the lock screen logs the mark with the Gate; an unmarked one logs nothing", async () => {
		const h = await startRun(
			sandbox,
			flowOf({
				start: "gate",
				nodes: [{ ...gate("gate", "Ready?", CHOICES), lockScreen: true }],
				edges: [],
			}),
		);
		await drive(h, {});
		const logged = await h.events();
		expect(payloads(logged, "GateOpened")).toEqual([
			{ question: "Ready?", choices: CHOICES, lockScreen: true },
		]);
		expect(deriveOpenGate(logged)?.lockScreen).toBe(true);

		const plain = await startRun(sandbox, gateFlow());
		await drive(plain, { inputs: { task: "it" } });
		expect(deriveOpenGate(await plain.events())?.lockScreen).toBe(false);
	});

	test("an answer without a note, and a choice without an edge, is a chosen end", async () => {
		const h = await startRun(sandbox, gateFlow());
		await drive(h, { inputs: { task: "it" } });
		const { state } = await drive(
			h,
			new Command({ resume: { kind: "gate", choice: "reject" } }),
		);
		expect(state.ended).toEqual({
			status: "finished",
			nodeId: "gate",
			outcome: "reject",
			reason: 'Ended at node "gate" with "reject".',
		});
		expect(payloads(await h.events(), "StepEnded")).toEqual([
			{
				outcome: "reject",
				outputs: { outcome: "reject", note: "", visit: 1 },
				error: null,
			},
		]);
	});

	test("a second run of the node while the Gate is open (a daemon restart) logs nothing twice", async () => {
		const h = await startRun(sandbox, gateFlow());
		const first = await drive(h, { inputs: { task: "it" } });
		const before = await h.events();
		const stepId = deriveSteps(before)[0]?.id as string;

		// invoke(null) on a new compile: the ask node interrupts again.
		const again = await drive(h, null, h.graph());
		expect(again.parked).toEqual(first.parked);
		expect(again.next).toEqual(["ask__gate"]);
		expect(again.events).toEqual([]);
		expect(await h.events()).toEqual(before);
		expect(
			(
				await readTranscriptFile(
					deriveSteps(before)[0]?.transcriptPath as string,
				)
			).map((e) => e.event.type),
		).toEqual(["gate-open"]);

		// And the answer still ends that same step.
		const answered = await drive(
			h,
			new Command({ resume: { kind: "gate", choice: "approve" } }),
			h.graph(),
		);
		expect(answered.state.ended?.nodeId).toBe("ship");
		expect(
			(await h.events()).filter((e) => e.type === "GateOpened"),
		).toHaveLength(1);
		expect((await h.events()).find((e) => e.type === "StepEnded")?.stepId).toBe(
			stepId,
		);
	});

	test("a daemon death between GateOpened and the checkpoint opens no second Gate", async () => {
		const h = await startRun(sandbox, gateFlow());
		// The node appended GateOpened and the transcript line and returned,
		// then the daemon died before its writes reached the checkpointer:
		// the thread is pending at the node, and only the log knows the Gate
		// is open.
		const putWrites = h.saver.putWrites.bind(h.saver);
		const put = h.saver.put.bind(h.saver);
		let dying = false;
		h.saver.putWrites = async (config, writes, taskId, taskPath) => {
			if (!dying && writes.some(([channel]) => channel === "pending")) {
				dying = true;
				throw new Error("the daemon died");
			}
			return putWrites(config, writes, taskId, taskPath);
		};
		h.saver.put = async (config, checkpoint, metadata) => {
			if (dying) throw new Error("the daemon died");
			return put(config, checkpoint, metadata);
		};
		await expect(drive(h, { inputs: { task: "it" } })).rejects.toThrow(
			"the daemon died",
		);
		h.saver.put = put;
		h.saver.putWrites = putWrites;
		const dead = await h.graph().getState(h.config);
		expect(dead.next).toEqual(["gate"]);
		expect(held(dead.values)).toBeNull();
		const before = await h.events();
		expect(before.map((e) => e.type)).toEqual([
			"RunStarted",
			"StepStarted",
			"GateOpened",
		]);
		const stepId = deriveSteps(before)[0]?.id as string;

		// The re-run finds the open Gate in the log and asks it, logging nothing.
		const again = await drive(h, null, h.graph());
		expect(again.next).toEqual(["ask__gate"]);
		expect(again.parked).toEqual([
			{
				kind: "gate",
				stepId,
				nodeId: "gate",
				question: "Ship it?",
				choices: CHOICES,
			},
		]);
		expect(held(again.state)).toMatchObject({ kind: "gate", stepId });
		expect(await h.events()).toEqual(before);

		const answered = await drive(
			h,
			new Command({ resume: { kind: "gate", choice: "approve" } }),
			h.graph(),
		);
		expect(answered.state.ended?.nodeId).toBe("ship");
		expect(answered.state.visits).toEqual({ gate: 1, ship: 1 });
		expect((await h.events()).find((e) => e.type === "StepEnded")?.stepId).toBe(
			stepId,
		);
	});

	test("a stop at the Gate and a resume asks again in a new visit, as often as it takes", async () => {
		const h = await startRun(sandbox, gateFlow());
		const first = await drive(h, { inputs: { task: "it" } });
		const stepId = (first.parked[0] as { stepId: string }).stepId;

		// The runner closed the Gate on the stop, the engine appended RunResumed.
		await stopAndResume(h, stepId, 1);
		const reopened = await drive(
			h,
			new Command({ resume: { kind: "reopen" } }),
			h.graph(),
		);
		// (`getState().next` is empty after a re-interrupt on a resume; the
		// interrupt itself, streamed and in `tasks[].interrupts`, is the fact.)
		const second = (reopened.parked[0] as { stepId: string }).stepId;
		expect(second).not.toBe(stepId);
		expect(reopened.parked).toEqual([
			{
				kind: "gate",
				stepId: second,
				nodeId: "gate",
				question: "Ship it?",
				choices: CHOICES,
			},
		]);
		expect(await h.types()).toEqual([
			"RunStarted",
			"StepStarted",
			"GateOpened",
			"StopRequested",
			"StepEnded",
			"RunEnded",
			"RunResumed",
			"StepStarted",
			"GateOpened",
		]);
		let logged = await h.events();
		expect(payloads(logged, "StepStarted")[1]).toMatchObject({
			nodeId: "gate",
			nodeType: "decision",
			visit: 2,
		});
		expect(deriveOpenGate(logged)).toMatchObject({ stepId: second, visit: 2 });
		expect(deriveSteps(logged).map((s) => [s.visit, s.outcome])).toEqual([
			[1, "stopped"],
			[2, null],
		]);
		expect(reopened.events).toEqual([
			{
				type: "step-started",
				stepId: second,
				nodeId: "gate",
				visit: 2,
				reopened: false,
			},
			{
				type: "transcript",
				entry: expect.objectContaining({
					stepId: second,
					event: { type: "gate-open", question: "Ship it?", choices: CHOICES },
				}),
			},
		]);

		// Stopped and resumed once more: exactly one more visit.
		await stopAndResume(h, second, 2);
		const twice = await drive(
			h,
			new Command({ resume: { kind: "reopen" } }),
			h.graph(),
		);
		const third = (twice.parked[0] as { stepId: string }).stepId;
		expect(third).not.toBe(second);
		expect(twice.parked[0]).toMatchObject({ kind: "gate", stepId: third });
		logged = await h.events();
		expect(logged.slice(-6).map((e) => e.type)).toEqual([
			"StopRequested",
			"StepEnded",
			"RunEnded",
			"RunResumed",
			"StepStarted",
			"GateOpened",
		]);
		expect(await h.types()).not.toContain("StepReopened");
		expect(logged.filter((e) => e.type === "GateOpened")).toHaveLength(3);
		expect(deriveSteps(logged).map((s) => [s.visit, s.outcome])).toEqual([
			[1, "stopped"],
			[2, "stopped"],
			[3, null],
		]);

		// A daemon restart while it is open again: nothing twice.
		const before = await h.events();
		const restarted = await drive(h, null, h.graph());
		expect(restarted.parked).toEqual(twice.parked);
		expect(await h.events()).toEqual(before);

		// The answer, on yet another compile.
		const answered = await drive(
			h,
			new Command({ resume: { kind: "gate", choice: "approve", note: "Go" } }),
			h.graph(),
		);
		expect(answered.state.ended?.nodeId).toBe("ship");
		expect(answered.state.visits).toEqual({ gate: 3, ship: 1 });
		logged = await h.events();
		expect(
			deriveSteps(logged).map((s) => [s.nodeId, s.visit, s.outcome]),
		).toEqual([
			["gate", 1, "stopped"],
			["gate", 2, "stopped"],
			["gate", 3, "approve"],
			["ship", 1, "pass"],
		]);
		expect(logged.filter((e) => e.type === "StepEnded")[2]).toMatchObject({
			stepId: third,
			payload: {
				outcome: "approve",
				outputs: { outcome: "approve", note: "Go", visit: 3 },
				error: null,
			},
		});
		// One transcript per visit; the seq keeps counting across them.
		const steps = deriveSteps(logged);
		const transcripts = await Promise.all(
			steps.slice(0, 3).map((s) => readTranscriptFile(s.transcriptPath)),
		);
		expect(transcripts.map((t) => t.map((e) => e.event.type))).toEqual([
			["gate-open"],
			["gate-open"],
			["gate-open", "gate-resolved"],
		]);
		expect(transcripts.flat().map((e) => e.seq)).toEqual([1, 2, 3, 4]);
	});

	test("a choice that is not one of the Gate's fails the step with a clear error", async () => {
		const h = await startRun(sandbox, gateFlow());
		await drive(h, { inputs: { task: "it" } });
		const { parked } = await drive(
			h,
			new Command({ resume: { kind: "gate", choice: "maybe" } }),
		);
		expect(parked).toEqual([
			{
				kind: "parked",
				stepId: deriveSteps(await h.events())[0]?.id as string,
				nodeId: "gate",
				status: "failed",
				reason:
					'Node "gate" failed: "maybe" is not an option of this node. Choose one of: approve, reject.',
			},
		]);
		expect(payloads(await h.events(), "StepEnded")).toEqual([
			{
				outcome: "error",
				outputs: { outcome: "error", note: "", visit: 1 },
				error:
					'"maybe" is not an option of this node. Choose one of: approve, reject.',
			},
		]);
	});

	test("a Gate that cannot open fails the step with today's error", async () => {
		const h = await startRun(sandbox, gateFlow());
		const { log } = h;
		h.ctx.log = {
			...log,
			append: (e, writes) =>
				e.type === "GateOpened"
					? Promise.reject(new Error("disk full"))
					: log.append(e, writes),
		};
		const { parked } = await drive(h, { inputs: { task: "it" } });
		expect(parked).toEqual([
			{
				kind: "parked",
				stepId: deriveSteps(await h.events())[0]?.id as string,
				nodeId: "gate",
				status: "failed",
				reason: 'Node "gate" failed: The Gate could not open: disk full',
			},
		]);
		expect(await h.types()).toEqual(["RunStarted", "StepStarted", "StepEnded"]);
		expect(payloads(await h.events(), "StepEnded")).toEqual([
			{
				outcome: "error",
				outputs: { outcome: "error", note: "", visit: 1 },
				error: "The Gate could not open: disk full",
			},
		]);
	});

	test("the entry checks park the run before the Gate opens", async () => {
		const h = await startRun(sandbox, gateFlow());
		await h.log.append({
			type: "StopAfterStepRequested",
			runId: h.runId,
			payload: {},
		});
		const { parked } = await drive(h, { inputs: { task: "it" } });
		expect(parked).toEqual([
			{
				kind: "parked",
				stepId: null,
				nodeId: "gate",
				status: "stopped",
				reason: "Stopped after the running step, as asked.",
			},
		]);
		expect(await h.types()).toEqual(["RunStarted", "StopAfterStepRequested"]);
	});
});

describe("a Gate's time budget", () => {
	test("a Gate waits as long as it must: timeoutMinutes starts no timer", async () => {
		const h = await startRun(
			sandbox,
			flowOf({
				start: "gate",
				nodes: [
					{
						...gate("gate", "Ship it?", [{ name: "approve" }]),
						timeoutMinutes: 1,
					},
				],
				edges: [],
			}),
		);
		h.ctx.minuteMs = 20;
		const first = await drive(h, { inputs: {} });
		expect(first.parked[0]).toMatchObject({ kind: "gate" });
		await new Promise((resolve) => setTimeout(resolve, 60));
		expect(await h.types()).toEqual([
			"RunStarted",
			"StepStarted",
			"GateOpened",
		]);
		const answered = await drive(
			h,
			new Command({ resume: { kind: "gate", choice: "approve" } }),
			h.graph(),
		);
		expect(answered.state.ended).toMatchObject({ outcome: "approve" });
	});

	test("the answer ends the step without announcing a start again", async () => {
		const h = await startRun(sandbox, gateFlow());
		await drive(h, { inputs: { task: "it" } });
		const answered = await drive(
			h,
			new Command({ resume: { kind: "gate", choice: "approve" } }),
			h.graph(),
		);
		expect(answered.events.map((e) => e.type)).toEqual([
			"transcript",
			"step-ended",
			"step-started",
			"transcript",
			"transcript",
			"transcript",
			"step-ended",
		]);
	});
});
