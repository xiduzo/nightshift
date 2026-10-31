import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Command } from "@langchain/langgraph";
import { defaultDeciderModel } from "@nightshift/agents/testing";
import type {
	Decider,
	DecisionInput,
	DecisionResult,
	ValueInput,
	ValueResult,
} from "@nightshift/agents/types";
import type { DecisionNode, ValueNode } from "@nightshift/flows";
import { defaultRunSettings } from "../device-config/settings";
import { foldRun } from "../log";
import { deriveSteps } from "../read/run-views";
import { command, drive, flowOf, held, startRun } from "../testing/graph";
import { createSandbox, type Sandbox } from "../testing/test-support";

/**
 * A Decision and a Value by model that climb a cascade (ADR 6), on the
 * compiled graph with a real run log and checkpoint saver.
 */

const at = { x: 0, y: 0 };

function triage(extra: Partial<DecisionNode> = {}): DecisionNode {
	return {
		id: "triage",
		type: "decision",
		position: at,
		prompt: "Bug or feature? Try {{cascade.try}} on {{cascade.tier}}.",
		options: [{ name: "bug" }, { name: "feature" }],
		by: "model",
		cascade: [
			{
				label: "local",
				decider: "typesafe",
				model: "small",
				minConfidence: 0.8,
			},
			{
				label: "strong",
				decider: "openrouter",
				model: "big",
				minConfidence: 0.6,
			},
		],
		...extra,
	};
}

/** Answers each call in turn with a pick and a probability, or an error. */
function picks(answers: (Partial<DecisionResult> | "error")[]) {
	const calls: DecisionInput[] = [];
	const decider: Decider = {
		defaultModel: defaultDeciderModel,
		async decide(input) {
			calls.push(input as DecisionInput);
			const answer = answers[calls.length - 1] ?? answers.at(-1);
			if (answer === "error" || answer === undefined) {
				return {
					kind: "error",
					errorKind: "harness",
					message: "The server did not answer.",
					costUsd: null,
				};
			}
			return {
				kind: "decided",
				label: "bug",
				notes: "",
				costUsd: 0.01,
				...answer,
			} as DecisionResult;
		},
	};
	return { decider, calls };
}

const flowWith = (node: DecisionNode | ValueNode) =>
	flowOf({
		start: node.id,
		nodes: [node, command("bugs", "true"), command("features", "true")],
		edges: [
			{ id: "e1", from: node.id, outcome: "bug", to: "bugs" },
			{ id: "e2", from: node.id, outcome: "feature", to: "features" },
			{ id: "e3", from: node.id, outcome: "pass", to: "bugs" },
		],
	});

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

describe("a Decision climbs its cascade", () => {
	test("a pick below the tier's minimum confidence goes to the next tier, each try a visit with its tier", async () => {
		const { decider, calls } = picks([
			{ label: "bug", probability: 0.55, notes: "Maybe a bug." },
			{ label: "feature", probability: 0.9, notes: "A new screen." },
		]);
		const h = await startRun(sandbox, flowWith(triage()), { decider });
		const { parked, state } = await drive(h, { inputs: {} });
		expect(parked).toEqual([]);
		expect(state.ended?.nodeId).toBe("features");
		expect(calls.map((c) => [c.decider, c.model, c.prompt])).toEqual([
			["typesafe", "small", "Bug or feature? Try 1 on local."],
			["openrouter", "big", "Bug or feature? Try 1 on strong."],
		]);
		const steps = deriveSteps(foldRun(await h.events())).filter(
			(step) => step.nodeId === "triage",
		);
		expect(steps.map((step) => [step.visit, step.outcome])).toEqual([
			[1, "fail"],
			[2, "feature"],
		]);
		expect(steps[0]?.outputs).toMatchObject({
			pick: "bug",
			confidence: 0.55,
			tier: "local",
			tries: 1,
		});
		expect(state.nodes.triage).toEqual({
			outcome: "feature",
			note: "A new screen.",
			visit: 2,
			tier: "strong",
			tries: 2,
			confidence: 0.9,
		});
		// The climb is done: the next visit starts at the first tier.
		expect(state.cascades?.triage).toBeNull();
		expect(state.traversals).toEqual({ e2: 1 });
	});

	test("without a person tier, the step ends fail when the last tier is not sure either", async () => {
		const { decider } = picks([{ label: "bug", probability: 0.3 }]);
		const h = await startRun(sandbox, flowWith(triage()), { decider });
		const { parked } = await drive(h, { inputs: {} });
		expect(parked).toEqual([
			{
				kind: "parked",
				stepId: expect.any(String),
				nodeId: "triage",
				status: "failed",
				reason:
					'Node "triage" ended with "fail" and no edge leaves it on that outcome.',
			},
		]);
	});

	test("a tier that cannot answer passes the question on", async () => {
		const { decider, calls } = picks([
			"error",
			{ label: "bug", probability: 0.7 },
		]);
		const h = await startRun(sandbox, flowWith(triage()), { decider });
		const { state } = await drive(h, { inputs: {} });
		expect(calls).toHaveLength(2);
		expect(state.ended?.nodeId).toBe("bugs");
	});

	test("a decider without a probability holds as the last tier", async () => {
		const { decider } = picks([
			{ label: "bug", probability: 0.2 },
			{ label: "feature" },
		]);
		const h = await startRun(
			sandbox,
			flowWith(
				triage({
					cascade: [
						{ decider: "typesafe", minConfidence: 0.8 },
						{ decider: "ollama", model: "qwen3" },
					],
				}),
			),
			{ decider },
		);
		const { state } = await drive(h, { inputs: {} });
		expect(state.ended?.nodeId).toBe("features");
		expect(state.nodes.triage).toMatchObject({ tier: "2", tries: 2 });
		expect(state.nodes.triage?.confidence).toBeUndefined();
	});

	test("the person tier is a Gate that shows each tier's pick and probability", async () => {
		const { decider } = picks([
			{ label: "bug", probability: 0.5 },
			{ label: "feature", probability: 0.4 },
		]);
		const node = triage({
			prompt: "Bug or feature?",
			cascade: [...(triage().cascade ?? []), { person: true }],
		});
		const h = await startRun(sandbox, flowWith(node), { decider });
		const first = await drive(h, { inputs: {} });
		expect(first.parked).toEqual([
			{
				kind: "gate",
				stepId: expect.any(String),
				nodeId: "triage",
				question:
					"Bug or feature?\n\nThe models were not sure enough:\n- local picked bug with 50%.\n- strong picked feature with 40%.",
				choices: [{ name: "bug" }, { name: "feature" }],
			},
		]);
		expect(held(first.state)).toMatchObject({ kind: "gate", climb: true });
		const second = await drive(
			h,
			new Command({
				resume: { kind: "gate", choice: "bug", note: "It crashes." },
			}),
			h.graph(),
		);
		expect(second.state.ended?.nodeId).toBe("bugs");
		expect(second.state.nodes.triage).toEqual({
			outcome: "bug",
			note: "It crashes.",
			visit: 3,
			tier: "person",
			tries: 3,
		});
		const steps = deriveSteps(foldRun(await h.events())).filter(
			(step) => step.nodeId === "triage",
		);
		expect(steps.map((step) => step.outcome)).toEqual(["fail", "fail", "bug"]);
	});

	test("every try counts toward the step cap, and a resume climbs on where it stopped", async () => {
		const { decider, calls } = picks([
			{ label: "bug", probability: 0.1 },
			{ label: "feature", probability: 0.95 },
		]);
		const h = await startRun(
			sandbox,
			flowWith(
				triage({
					cascade: [
						{
							label: "local",
							decider: "typesafe",
							minConfidence: 0.8,
							tries: 1,
						},
						{ label: "strong", decider: "openrouter", minConfidence: 0.6 },
					],
				}),
			),
			{ decider },
		);
		h.ctx.settings = () => ({ ...defaultRunSettings(), maxStepsPerRun: 1 });
		const first = await drive(h, { inputs: {} });
		expect(first.parked).toEqual([
			{
				kind: "parked",
				stepId: null,
				nodeId: "triage",
				status: "failed",
				reason:
					'The run reached the limit of 1 steps before node "triage". Resume it to continue.',
			},
		]);
		expect(calls).toHaveLength(1);
		expect(first.state.cascades?.triage).toMatchObject({ tier: 1, try: 1 });

		h.ctx.settings = defaultRunSettings;
		await h.log.append({
			type: "RunResumed",
			runId: h.runId,
			payload: {
				nodeId: "triage",
				stepId: null,
				prompt: null,
				scope: null,
				by: "person",
			},
		});
		const second = await drive(h, new Command({ resume: { kind: "resume" } }));
		expect(second.parked).toEqual([]);
		expect(second.state.ended?.nodeId).toBe("features");
		// The second tier, not the first again.
		expect(calls.map((c) => c.decider)).toEqual(["typesafe", "openrouter"]);
	});
});

describe("the budget of a climb", () => {
	test("every try spends from the run's budget, and the climb stops when it is spent", async () => {
		const { decider, calls } = picks([{ label: "bug", probability: 0.1 }]);
		const node = triage({
			cascade: [
				{ decider: "typesafe", minConfidence: 0.9 },
				{ decider: "openrouter", minConfidence: 0.9 },
				{ decider: "openai", minConfidence: 0.9 },
			],
		});
		const h = await startRun(
			sandbox,
			{ ...flowWith(node), policy: { budgetUsd: 0.015 } },
			{ decider },
		);
		const { parked } = await drive(h, { inputs: {} });
		expect(calls).toHaveLength(2);
		expect(parked[0]).toMatchObject({
			kind: "parked",
			nodeId: "triage",
			status: "failed",
		});
		expect((parked[0] as { reason: string }).reason).toContain("budget");
	});
});

describe("a Value climbs its cascade", () => {
	const plan = (extra: Partial<ValueNode> = {}): ValueNode => ({
		id: "plan",
		type: "value",
		position: at,
		by: "model",
		prompt: "Plan it. {{cascade.previous.summary}}",
		output: {
			type: "object",
			properties: { tasks: { type: "array" } },
			required: ["tasks"],
		},
		cascade: [
			{ label: "local", decider: "ollama", accept: "$count(data.tasks) > 0" },
			{ label: "strong", decider: "openrouter" },
		],
		...extra,
	});

	function makes(answers: unknown[]) {
		const calls: ValueInput[] = [];
		const decider: Decider = {
			defaultModel: defaultDeciderModel,
			async decide() {
				throw new Error("A Value asks for a value, not a pick.");
			},
			async value(input): Promise<ValueResult> {
				calls.push(input);
				return { kind: "made", data: answers[calls.length - 1], costUsd: 0 };
			},
		};
		return { decider, calls };
	}

	test("data the accept rule refuses goes to the next tier, which reads why", async () => {
		const { decider, calls } = makes([{ tasks: [] }, { tasks: ["a"] }]);
		const h = await startRun(sandbox, flowWith(plan()), { decider });
		const { state } = await drive(h, { inputs: {} });
		expect(state.ended?.nodeId).toBe("bugs");
		expect(calls.map((c) => c.decider)).toEqual(["ollama", "openrouter"]);
		expect(calls[1]?.prompt).toBe(
			"Plan it. The value does not pass the accept rule of the tier: $count(data.tasks) > 0",
		);
		expect(state.nodes.plan).toMatchObject({
			outcome: "pass",
			data: { tasks: ["a"] },
			tier: "strong",
			tries: 2,
		});
	});

	test("data that does not match the schema climbs too, and the last tier's fail ends the step", async () => {
		const { decider } = makes([{ nope: 1 }, { nope: 2 }]);
		const h = await startRun(sandbox, flowWith(plan()), { decider });
		const { parked, state } = await drive(h, { inputs: {} });
		expect(parked[0]).toMatchObject({ kind: "parked", nodeId: "plan" });
		expect(state.nodes.plan).toMatchObject({ outcome: "fail", tries: 2 });
	});
});
