import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Command } from "@langchain/langgraph";
import { fakeDecider } from "@nightshift/agents/testing";
import type { ValueNode } from "@nightshift/flows";
import { readTranscriptFile } from "../log/transcripts";
import { deriveSteps } from "../read/derive-steps";
import {
	command,
	drive,
	flowOf,
	held,
	payloads,
	startRun,
} from "../testing/graph";
import { createSandbox, type Sandbox } from "../testing/test-support";
import { DEFAULT_RESUME_PROMPT } from "./context";

/**
 * The Value node on the compiled graph: a rule (JSONata) or a scripted
 * decider makes the data, with a real run log and checkpoint saver. Mirrors
 * decision-node.test.ts: the log, the transcript, the cost and the edges
 * are checked as the engine writes them.
 */

const OUTPUT = {
	type: "object",
	properties: { small: { type: "array", items: { type: "string" } } },
	required: ["small"],
};

const byRule = (
	id: string,
	expression: string,
	extra: Partial<ValueNode> = {},
): ValueNode => ({
	id,
	type: "value",
	position: { x: 0, y: 0 },
	by: "rule",
	expression,
	output: OUTPUT,
	decider: "openrouter",
	...extra,
});

const byModel = (id: string, extra: Partial<ValueNode> = {}): ValueNode => ({
	id,
	type: "value",
	position: { x: 0, y: 0 },
	by: "model",
	prompt: "Which of {{tasks}} are small?",
	output: OUTPUT,
	decider: "openrouter",
	...extra,
});

/** A flow: the Value node, then `done` on pass and `again` on fail. */
const around = (node: ValueNode) =>
	flowOf({
		inputs: [{ name: "tasks", type: "json" }],
		start: node.id,
		nodes: [node, command("done", "true"), command("again", "true")],
		edges: [
			{ id: "ok", from: node.id, outcome: "pass", to: "done" },
			{ id: "no", from: node.id, outcome: "fail", to: "again" },
		],
	});

const tasks = [
	{ name: "a", size: "small" },
	{ name: "b", size: "large" },
	{ name: "c", size: "small" },
];

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

describe("the Value node made by a rule", () => {
	test("the expression's result is the data: the log, the transcript, the state and the edge; no cost, no wait node", async () => {
		const h = await startRun(
			sandbox,
			around(byRule("small", '{ "small": tasks[size = "small"].name }')),
		);
		expect(h.graph().getGraph().nodes).not.toHaveProperty("wait__small");
		const { parked, state, events } = await drive(h, { inputs: { tasks } });
		expect(parked).toEqual([]);
		expect(state.ended?.nodeId).toBe("done");
		expect(await h.types()).toEqual([
			"RunStarted",
			"StepStarted",
			"StepEnded",
			"EdgeTaken",
			"StepStarted",
			"StepEnded",
		]);
		const logged = await h.events();
		expect(payloads(logged, "StepStarted")[0]).toMatchObject({
			nodeId: "small",
			nodeType: "value",
			visit: 1,
			logPath: null,
		});
		expect(payloads(logged, "StepEnded")[0]).toEqual({
			outcome: "pass",
			outputs: {
				outcome: "pass",
				data: { small: ["a", "c"] },
				note: "",
				visit: 1,
			},
			error: null,
		});
		expect(payloads(logged, "EdgeTaken")).toEqual([
			{ edgeId: "ok", from: "small", to: "done", outcome: "pass", scope: null },
		]);
		const [step] = deriveSteps(logged);
		expect(step?.cost.usd).toBe(0);
		expect(step?.sessions).toEqual([]);
		const transcript = await readTranscriptFile(step?.transcriptPath as string);
		expect(transcript.map((e) => e.event)).toEqual([
			{
				type: "value-start",
				by: "rule",
				source: '{ "small": tasks[size = "small"].name }',
				model: null,
			},
			{ type: "value", data: { small: ["a", "c"] }, problem: null },
		]);
		expect(state.nodes.small).toEqual({
			outcome: "pass",
			data: { small: ["a", "c"] },
			note: "",
			visit: 1,
		});
		expect(events.slice(0, 4).map((e) => e.type)).toEqual([
			"step-started",
			"transcript",
			"transcript",
			"step-ended",
		]);
	});

	test("a result that does not match the output schema fails the step, with why in the note, and takes the fail edge", async () => {
		const h = await startRun(
			sandbox,
			around(byRule("small", '{ "small": "a" }')),
		);
		const { parked, state } = await drive(h, { inputs: { tasks } });
		expect(parked).toEqual([]);
		expect(state.ended?.nodeId).toBe("again");
		const [ended] = payloads(await h.events(), "StepEnded");
		expect(ended).toEqual({
			outcome: "fail",
			outputs: {
				outcome: "fail",
				data: null,
				note: "The value does not match the output schema: data/small must be array.",
				visit: 1,
			},
			error: null,
		});
		const [step] = deriveSteps(await h.events());
		const transcript = await readTranscriptFile(step?.transcriptPath as string);
		expect(transcript[1]?.event).toEqual({
			type: "value",
			data: null,
			problem:
				"The value does not match the output schema: data/small must be array.",
		});
	});

	test("an expression that throws fails the step with JSONata's message", async () => {
		const h = await startRun(
			sandbox,
			around(byRule("small", '$error("boom")')),
		);
		const { state } = await drive(h, { inputs: { tasks } });
		expect(state.ended?.nodeId).toBe("again");
		expect(payloads(await h.events(), "StepEnded")[0]).toMatchObject({
			outcome: "fail",
			outputs: { data: null, note: "The expression failed: boom" },
			error: null,
		});
	});

	test("an output schema that is not a valid JSON Schema errors the step and parks the run", async () => {
		const h = await startRun(
			sandbox,
			around(
				byRule("small", "{}", {
					output: { type: "object", properties: { small: { type: "nope" } } },
				}),
			),
		);
		const { parked, next } = await drive(h, { inputs: { tasks } });
		expect(next).toEqual(["park__small"]);
		expect(parked[0]).toMatchObject({
			kind: "parked",
			nodeId: "small",
			status: "failed",
			reason: expect.stringContaining("is not a valid JSON Schema"),
		});
		expect(payloads(await h.events(), "StepEnded")[0]).toMatchObject({
			outcome: "error",
			outputs: { outcome: "error", data: null, note: "", visit: 1 },
		});
	});
});

describe("the Value node made by a model", () => {
	test("the decider's data is the value: its input, the transcript, the cost and the edge", async () => {
		const decider = fakeDecider([], {
			values: [{ data: { small: ["a", "c"] }, costUsd: 0.02 }],
		});
		const h = await startRun(sandbox, around(byModel("small")), { decider });
		expect(h.graph().getGraph().nodes).toHaveProperty("wait__small");
		const { parked, state } = await drive(h, { inputs: { tasks } });
		expect(parked).toEqual([]);
		expect(state.ended?.nodeId).toBe("done");
		expect(decider.calls).toEqual([]);
		expect(decider.valueCalls).toHaveLength(1);
		expect(decider.valueCalls[0]).toMatchObject({
			decider: "openrouter",
			prompt: `Which of ${JSON.stringify(tasks)} are small?`,
			output: OUTPUT,
			model: "~openai/gpt-mini-latest",
		});
		const logged = await h.events();
		expect(payloads(logged, "StepEnded")[0]).toEqual({
			outcome: "pass",
			outputs: {
				outcome: "pass",
				data: { small: ["a", "c"] },
				note: "",
				visit: 1,
			},
			error: null,
			costUsd: 0.02,
			costSource: "reported",
		});
		const [step] = deriveSteps(logged);
		expect(step?.cost.usd).toBeCloseTo(0.02);
		const transcript = await readTranscriptFile(step?.transcriptPath as string);
		expect(transcript.map((e) => e.event)).toEqual([
			{
				type: "value-start",
				by: "model",
				source: `Which of ${JSON.stringify(tasks)} are small?`,
				model: "~openai/gpt-mini-latest",
			},
			{ type: "value", data: { small: ["a", "c"] }, problem: null },
		]);
	});

	test("the node's own model reaches the decider", async () => {
		const decider = fakeDecider([], { values: [{ data: { small: [] } }] });
		const h = await startRun(
			sandbox,
			around(byModel("small", { model: "openai/gpt-5-mini" })),
			{ decider },
		);
		await drive(h, { inputs: { tasks } });
		expect(decider.valueCalls[0]?.model).toBe("openai/gpt-5-mini");
	});

	test("a decider failure fails the step with its cost, and takes the fail edge", async () => {
		const decider = fakeDecider([], {
			values: [
				{ kind: "error", errorKind: "harness", message: "boom", costUsd: 0.03 },
			],
		});
		const h = await startRun(sandbox, around(byModel("small")), { decider });
		const { state } = await drive(h, { inputs: { tasks } });
		expect(state.ended?.nodeId).toBe("again");
		expect(payloads(await h.events(), "StepEnded")[0]).toEqual({
			outcome: "fail",
			outputs: {
				outcome: "fail",
				data: null,
				note: "The model failed: boom",
				visit: 1,
			},
			error: null,
			costUsd: 0.03,
			costSource: "reported",
		});
	});

	test("data that does not match the output schema fails the step", async () => {
		const decider = fakeDecider([], {
			values: [{ data: { small: "a" }, costUsd: 0.01 }],
		});
		const h = await startRun(sandbox, around(byModel("small")), { decider });
		const { state } = await drive(h, { inputs: { tasks } });
		expect(state.ended?.nodeId).toBe("again");
		expect(payloads(await h.events(), "StepEnded")[0]).toMatchObject({
			outcome: "fail",
			outputs: {
				data: null,
				note: "The value does not match the output schema: data/small must be array.",
			},
			costUsd: 0.01,
			costSource: "reported",
		});
	});

	test("without a decider the step errors", async () => {
		const h = await startRun(sandbox, around(byModel("small")));
		const { parked } = await drive(h, { inputs: { tasks } });
		expect(parked[0]).toMatchObject({
			status: "failed",
			reason: 'Node "small" failed: No decider is configured for Value nodes.',
		});
	});

	test("a usage limit parks the run at the wait node; a wake asks again in the same step", async () => {
		const decider = fakeDecider([], {
			values: (_input, call) =>
				call === 0
					? {
							kind: "error",
							errorKind: "usage-limit",
							message: "You've hit your limit.",
							costUsd: null,
						}
					: { data: { small: ["a"] }, costUsd: 0.01 },
		});
		const h = await startRun(sandbox, around(byModel("small")), { decider });
		const first = await drive(h, { inputs: { tasks } });
		const [step] = deriveSteps(await h.events());
		const stepId = step?.id as string;
		expect(first.next).toEqual(["wait__small"]);
		expect(first.parked).toEqual([
			{
				kind: "wait",
				stepId,
				nodeId: "small",
				reason: "usage-limit",
				until: expect.any(Number),
				message: expect.stringContaining("continues in 5 min"),
			},
		]);
		expect(held(first.state)).toMatchObject({
			kind: "wait",
			stepId,
			nodeId: "small",
			visit: 1,
			session: { harnessSessionId: null, prompt: DEFAULT_RESUME_PROMPT },
		});
		expect(await h.types()).toEqual([
			"RunStarted",
			"StepStarted",
			"WaitStarted",
		]);

		await h.log.append({
			type: "WaitEnded",
			runId: h.runId,
			stepId,
			payload: { early: false },
		});
		const second = await drive(
			h,
			new Command({ resume: { kind: "wake", early: false } }),
			h.graph(),
		);
		expect(second.parked).toEqual([]);
		expect(second.state.ended?.nodeId).toBe("done");
		expect(decider.valueCalls).toHaveLength(2);
		const steps = deriveSteps(await h.events());
		expect(steps.map((s) => s.nodeId)).toEqual(["small", "done"]);
		expect(steps[0]).toMatchObject({ id: stepId, visit: 1, outcome: "pass" });
		const transcript = await readTranscriptFile(
			steps[0]?.transcriptPath as string,
		);
		expect(transcript.map((e) => e.event.type)).toEqual([
			"value-start",
			"wait",
			"value-start",
			"value",
		]);
	});
});
