import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	defaultDeciderModel,
	fakeHarness,
	reportingScript,
} from "@nightshift/agents/testing";
import type {
	Decider,
	DecisionResult,
	ValueInput,
	ValueResult,
} from "@nightshift/agents/types";
import type { DecisionNode } from "@nightshift/flows";
import { now } from "@nightshift/time";
import { foldRun } from "../log";
import { deriveSteps } from "../read/run-views";
import {
	agent,
	command,
	drive,
	flowOf,
	MINUTE,
	payloads,
	startRun,
} from "../testing/graph";
import { runEvents } from "../testing/run-events";
import { createSandbox, type Sandbox } from "../testing/test-support";
import { backgroundItems } from "./gate-brief";

/**
 * The brief of a Gate (ADR 21) as the Gate opens, on the compiled graph
 * with a real run log: the author's fields first, then one model call for
 * the parts still empty. The model never blocks the Gate.
 */

const at = { x: 0, y: 0 };

function gate(extra: Partial<DecisionNode> = {}): DecisionNode {
	return {
		id: "ship",
		type: "decision",
		position: at,
		prompt: "Ship it?",
		options: [{ name: "approve" }, { name: "reject" }],
		by: "person",
		...extra,
	};
}

/** A step before the Gate, so the model reads the run so far. */
const flowWith = (node: DecisionNode) =>
	flowOf({
		start: "build",
		nodes: [command("build", 'echo "The tests pass."'), node],
		edges: [{ id: "e1", from: "build", outcome: "pass", to: node.id }],
	});

/** Everything the model writes, when it is asked for every part. */
const MODEL_BRIEF = {
	urgency: "now",
	situation: "The release waits for you.",
	background: [{ text: "The tests pass.", source: "build" }],
	recommendation: { option: "approve", reason: "Everything is green." },
	impacts: { approve: "It ships tonight.", reject: "Nothing ships." },
};

/** A decider that makes values with `answer`, and records each ask. */
function valueDecider(
	answer: (input: ValueInput) => Promise<ValueResult> | ValueResult,
) {
	const calls: ValueInput[] = [];
	const decider: Decider = {
		defaultModel: defaultDeciderModel,
		async decide(): Promise<DecisionResult> {
			throw new Error("A Gate asks no decision.");
		},
		async value(input) {
			calls.push(input);
			return answer(input);
		},
	};
	return { decider, calls };
}

const made = (data: unknown): ValueResult => ({
	kind: "made",
	data,
	costUsd: 0.002,
});

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

describe("a model fills the brief", () => {
	test("a Gate without a brief gets the model's parts, marked as the model's, and the step its cost", async () => {
		const { decider, calls } = valueDecider(() => made(MODEL_BRIEF));
		const h = await startRun(sandbox, flowWith(gate()), { decider });
		const { next } = await drive(h, { inputs: {} });
		expect(next).toEqual(["ask__ship"]);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.decider).toBe("openrouter");
		expect(calls[0]?.prompt).toContain("Ship it?");
		// The run so far: the step before, with what it said.
		expect(calls[0]?.prompt).toContain("- build (command) ended pass");
		expect(calls[0]?.output.required).toEqual([
			"urgency",
			"situation",
			"background",
			"recommendation",
			"impacts",
		]);
		const events = await h.events();
		const [opened] = payloads(events, "GateOpened");
		expect(opened).toEqual({
			question: "Ship it?",
			choices: [
				{ name: "approve", impact: "It ships tonight." },
				{ name: "reject", impact: "Nothing ships." },
			],
			urgency: "now",
			brief: {
				urgencyBy: "model",
				situation: "The release waits for you.",
				background: [{ text: "The tests pass.", source: "build" }],
				recommendation: {
					option: "approve",
					reason: "Everything is green.",
				},
				byModel: [
					"urgency",
					"situation",
					"background",
					"recommendation",
					"impacts",
				],
			},
			briefCostUsd: 0.002,
			briefCostSource: "reported",
		});
		const state = foldRun(events);
		expect(state.gate).toMatchObject({ urgency: "now" });
		const step = deriveSteps(state).find((one) => one.nodeId === "ship");
		expect(step?.cost).toMatchObject({ usd: 0.002, calls: 1 });
	});

	test("the author's text wins: the model writes only what is empty", async () => {
		const { decider, calls } = valueDecider(() => made(MODEL_BRIEF));
		const node = gate({
			urgency: "later",
			situation: "You pick the release of {{build.exit_code}}.",
			options: [
				{ name: "approve", impact: "It ships." },
				{ name: "reject", impact: "It waits." },
			],
		});
		const h = await startRun(sandbox, flowWith(node), { decider });
		await drive(h, { inputs: {} });
		expect(calls[0]?.output.required).toEqual(["background", "recommendation"]);
		const [opened] = payloads(await h.events(), "GateOpened");
		expect(opened?.urgency).toBe("later");
		expect(opened?.brief).toEqual({
			urgencyBy: "flow",
			situation: "You pick the release of 0.",
			background: [{ text: "The tests pass.", source: "build" }],
			recommendation: { option: "approve", reason: "Everything is green." },
			byModel: ["background", "recommendation"],
		});
		expect(opened?.choices).toEqual([
			{ name: "approve", impact: "It ships." },
			{ name: "reject", impact: "It waits." },
		]);
	});

	test("fillBrief false asks no model", async () => {
		const { decider, calls } = valueDecider(() => made(MODEL_BRIEF));
		const node = gate({ fillBrief: false, situation: "Only this." });
		const h = await startRun(sandbox, flowWith(node), { decider });
		await drive(h, { inputs: {} });
		expect(calls).toEqual([]);
		const [opened] = payloads(await h.events(), "GateOpened");
		expect(opened?.urgency).toBe("today");
		expect(opened?.brief).toMatchObject({
			urgencyBy: "default",
			situation: "Only this.",
			byModel: [],
		});
		expect(opened?.briefCostUsd).toBeUndefined();
	});

	test("a template urgency that renders to something else is left out, and a recommendation of no option goes", async () => {
		const node = gate({
			urgency: "{{build.output}}",
			recommend: { option: "merge" },
			fillBrief: false,
		});
		const h = await startRun(sandbox, flowWith(node), {});
		await drive(h, { inputs: {} });
		const [opened] = payloads(await h.events(), "GateOpened");
		// Nothing to say: the Gate logs no brief, and reads as today.
		expect(opened).toEqual({
			question: "Ship it?",
			choices: [{ name: "approve" }, { name: "reject" }],
		});
		expect(foldRun(await h.events()).gate).toMatchObject({
			urgency: "today",
			brief: { urgencyBy: "default", recommendation: null },
		});
	});
});

describe("the model never blocks the Gate", () => {
	test("a decider that throws: the Gate opens with what it has", async () => {
		const { decider, calls } = valueDecider(() => {
			throw new Error("The server is down.");
		});
		const h = await startRun(sandbox, flowWith(gate()), { decider });
		const { next } = await drive(h, { inputs: {} });
		expect(next).toEqual(["ask__ship"]);
		expect(calls).toHaveLength(1);
		expect(payloads(await h.events(), "GateOpened")).toEqual([
			{
				question: "Ship it?",
				choices: [{ name: "approve" }, { name: "reject" }],
			},
		]);
	});

	test("a decider that answers with an error: the Gate opens, the cost still counts", async () => {
		const { decider } = valueDecider(() => ({
			kind: "error",
			errorKind: "harness",
			message: "Rate limited.",
			costUsd: 0.001,
		}));
		const h = await startRun(sandbox, flowWith(gate()), { decider });
		await drive(h, { inputs: {} });
		const [opened] = payloads(await h.events(), "GateOpened");
		expect(opened?.brief).toBeUndefined();
		expect(opened?.briefCostUsd).toBe(0.001);
	});

	test("a decider that does not answer in a minute: the Gate opens without it", async () => {
		const { decider, calls } = valueDecider(
			(input) =>
				new Promise<ValueResult>((resolve) => {
					// Answers late, long after the minute.
					setTimeout(() => resolve(made(MODEL_BRIEF)), 20 * MINUTE);
					input.signal.addEventListener("abort", () => {});
				}),
		);
		const h = await startRun(sandbox, flowWith(gate()), { decider });
		const started = now();
		const { next } = await drive(h, { inputs: {} });
		expect(next).toEqual(["ask__ship"]);
		expect(now() - started).toBeLessThan(10 * MINUTE);
		expect(calls[0]?.signal.aborted).toBe(true);
		expect(payloads(await h.events(), "GateOpened")).toEqual([
			{
				question: "Ship it?",
				choices: [{ name: "approve" }, { name: "reject" }],
			},
		]);
	});
});

describe("the person tier of a cascade", () => {
	test("without the flow's words: what each tier picked, and the surest pick", async () => {
		const answers: Partial<DecisionResult>[] = [
			{ label: "approve", probability: 0.4 },
			{ label: "reject", probability: 0.55 },
		];
		let call = 0;
		const decider: Decider = {
			defaultModel: defaultDeciderModel,
			async decide() {
				const answer = answers[call++] ?? {};
				return {
					kind: "decided",
					label: "approve",
					notes: "",
					costUsd: 0.01,
					...answer,
				} as DecisionResult;
			},
		};
		const node = gate({
			by: "model",
			cascade: [
				{ label: "small", decider: "typesafe", minConfidence: 0.8 },
				{ label: "big", decider: "openrouter", minConfidence: 0.8 },
				{ person: true, urgency: "now" },
			],
		});
		const h = await startRun(sandbox, flowWith(node), { decider });
		const { next } = await drive(h, { inputs: {} });
		expect(next).toEqual(["ask__ship"]);
		const [opened] = payloads(await h.events(), "GateOpened");
		expect(opened?.urgency).toBe("now");
		expect(opened?.brief).toEqual({
			urgencyBy: "flow",
			situation: null,
			background: [
				{ text: "small picked approve with 40%.", source: "small" },
				{ text: "big picked reject with 55%.", source: "big" },
			],
			recommendation: {
				option: "reject",
				reason: "The tier big was the most sure: 55%.",
			},
			byModel: [],
		});
	});
});

describe("an Agent that asks a person", () => {
	test("its report's brief goes with its Gate, with no model call", async () => {
		const { decider, calls } = valueDecider(() => made(MODEL_BRIEF));
		const script = reportingScript("needs-input", "Which database?");
		const harness = fakeHarness({
			...script,
			steps: (script.steps ?? []).map((step) =>
				step.type === "report"
					? {
							type: "event" as const,
							event: {
								...step,
								ask: {
									urgency: "today",
									situation: "The schema needs a database.",
									background: ["Postgres runs in CI (source: ci.yml)"],
									recommend: { choice: "answer", reason: "Name one." },
									impacts: { stop: "The step fails." },
								},
							},
						}
					: step,
			),
		});
		const h = await startRun(
			sandbox,
			flowOf({
				start: "worker",
				nodes: [agent("worker", "Work on {{task}}", { ask: "person" })],
				edges: [],
			}),
			{ harness, decider },
		);
		const { next } = await drive(h, { inputs: { task: "x" } });
		expect(next).toEqual(["ask__worker"]);
		expect(calls).toEqual([]);
		const [opened] = payloads(await h.events(), "GateOpened");
		expect(opened?.urgency).toBe("today");
		expect(opened?.brief).toEqual({
			urgencyBy: "flow",
			situation: "The schema needs a database.",
			background: [{ text: "Postgres runs in CI", source: "ci.yml" }],
			recommendation: { option: "answer", reason: "Name one." },
			byModel: [],
		});
		expect(opened?.choices.map((choice) => choice.impact)).toEqual([
			undefined,
			"The step fails.",
		]);
	});
});

describe("the log", () => {
	test("a Gate opened without a brief (an older log) reads as today, set by default, with an empty brief", () => {
		const b = runEvents()
			.runStarted()
			.stepStarted("s1", "gate")
			.gateOpened("s1");
		expect(b.state().gate).toMatchObject({
			urgency: "today",
			brief: {
				urgencyBy: "default",
				situation: null,
				background: [],
				recommendation: null,
				byModel: [],
			},
		});
		expect(deriveSteps(b.state())[0]?.gateWaits[0]?.urgency).toBe("today");
	});

	test("an answered Gate keeps its urgency, and the brief's cost counts on the step", () => {
		const b = runEvents()
			.runStarted()
			.stepStarted("s1", "gate")
			.push(
				"GateOpened",
				{
					question: "Ship it?",
					choices: [{ name: "approve" }],
					urgency: "now",
					brief: {
						urgencyBy: "model",
						situation: null,
						background: [],
						recommendation: null,
						byModel: ["urgency"],
					},
					briefCostUsd: 0.003,
				},
				{ stepId: "s1" },
			)
			.stepEnded("s1", "approve");
		const [step] = deriveSteps(b.state());
		expect(step?.gateWaits[0]).toMatchObject({ urgency: "now" });
		expect(step?.cost).toMatchObject({ usd: 0.003, calls: 1 });
	});
});

describe("backgroundItems", () => {
	test("a `- ` line is one item, a source chip ends one, plain text is one item", () => {
		expect(
			backgroundItems(
				"- The tests pass (source: CI)\n- The review is done\n  by two people.",
			),
		).toEqual([
			{ text: "The tests pass", source: "CI" },
			{ text: "The review is done by two people.", source: null },
		]);
		expect(backgroundItems("Everything is green.\nNothing waits.")).toEqual([
			{ text: "Everything is green.\nNothing waits.", source: null },
		]);
		expect(backgroundItems("   ")).toEqual([]);
	});
});
