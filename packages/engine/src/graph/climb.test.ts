import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import {
	defaultDeciderModel,
	fakeHarness,
	reportingScript,
} from "@nightshift/agents/testing";
import type {
	Decider,
	DecisionInput,
	ValueInput,
	ValueResult,
} from "@nightshift/agents/types";
import type {
	AgentNode,
	CallNode,
	CascadeNode,
	DecisionNode,
	PersonTier,
	ValueNode,
} from "@nightshift/flows";
import { foldRun, type RungBy } from "../log";
import { deriveSteps } from "../read/run-views";
import {
	agent,
	command,
	drive,
	flowOf,
	type Harness,
	held,
	payloads,
	type StartOptions,
	startRun,
} from "../testing/graph";
import { createSandbox, type Sandbox } from "../testing/test-support";
import { climbing } from "./climb";
import type { StepContext } from "./context";
import type { RunStateValues } from "./state";

/**
 * The climb (ADR 6, `climb.ts`) across the four node types with a
 * cascade, on the compiled graph with a real run log and checkpoint
 * saver. Each kind runs the same climb: two tiers, `small` then `big`,
 * and in some tests a person tier. Only what a try does differs.
 */

/** What each try reads of the climb. */
const READS =
	"Try {{cascade.try}} on {{cascade.tier}} after {{cascade.previous.outcome}}.";

/** The person tier: its situation reads the climb (`{{cascade.*}}`). */
const PERSON: PersonTier = {
	person: true,
	fillBrief: false,
	situation: "{{cascade.previous.tier}} did not hold.",
};

/** One node type with a cascade, as this test runs it. */
type Kind = {
	label: string;
	/** The node with the cascade, its id `work`; with the person tier last when `person`. */
	node(person: boolean): CascadeNode;
	/** Who tries a tier that is not a person (`StepStarted.rung`). */
	by: RungBy;
	/** The outcome of a try that holds. */
	holds: string;
	/** The run's Device and flows, when the tries hold as `holds` says, in order. */
	setup(holds: boolean[]): {
		options: StartOptions;
		reads(h: Harness): Promise<string[]>;
	};
};

const at = { x: 0, y: 0 };

const AGENT: Kind = {
	label: "Agent",
	by: "agent",
	holds: "pass",
	node: (person) => {
		const { harness: _h, model: _m, ...plain } = agent("work", READS);
		return {
			...plain,
			cascade: [
				{ label: "small", model: "sonnet", harness: "claude-code" },
				{ label: "big", model: "opus", harness: "claude-code" },
				...(person ? [PERSON] : []),
			],
		} satisfies AgentNode;
	},
	setup: (holds) => {
		const harness = fakeHarness((_input, call) =>
			reportingScript(holds[call] ? "pass" : "fail", `Try ${call + 1}.`),
		);
		return {
			options: { harness },
			// The next try's prompt starts with the task, then the failure.
			reads: async () =>
				harness.calls.map((call) => call.prompt.split("\n")[0] ?? ""),
		};
	},
};

const SUBFLOW: Kind = {
	label: "Subflow",
	by: "flow",
	holds: "pass",
	node: (person) =>
		({
			id: "work",
			type: "call",
			position: at,
			flow: "small",
			inputs: {},
			cascade: [
				{ label: "small", flow: "small", inputs: { reads: READS } },
				{ label: "big", flow: "big", inputs: { reads: READS } },
				...(person ? [PERSON] : []),
			],
		}) satisfies CallNode,
	setup: (holds) => {
		const body = (holding: boolean) =>
			flowOf({
				inputs: [{ name: "reads" }],
				start: "step",
				nodes: [command("step", holding ? "true" : "exit 1")],
				edges: [],
			});
		return {
			options: {
				flows: {
					small: body(holds[0] === true),
					big: body(holds[1] === true),
				},
			},
			reads: async (h) =>
				steps(h).then((all) =>
					all.map((step) => String(step.call?.inputs.reads ?? "")),
				),
		};
	},
};

const DECISION: Kind = {
	label: "Decision",
	by: "model",
	holds: "yes",
	node: (person) =>
		({
			id: "work",
			type: "decision",
			position: at,
			prompt: READS,
			options: [{ name: "yes" }, { name: "no" }],
			by: "model",
			cascade: [
				{ label: "small", decider: "typesafe", minConfidence: 0.8 },
				{ label: "big", decider: "openrouter", minConfidence: 0.8 },
				...(person ? [PERSON] : []),
			],
		}) satisfies DecisionNode,
	setup: (holds) => {
		const calls: DecisionInput[] = [];
		const decider: Decider = {
			defaultModel: defaultDeciderModel,
			async decide(input) {
				calls.push(input as DecisionInput);
				const sure = holds[calls.length - 1] === true;
				return {
					kind: "decided",
					label: "yes",
					notes: "",
					probability: sure ? 0.9 : 0.1,
					costUsd: 0,
				};
			},
		};
		return {
			options: { decider },
			reads: async () => calls.map((call) => call.prompt),
		};
	},
};

const VALUE: Kind = {
	label: "Value",
	by: "model",
	holds: "pass",
	node: (person) =>
		({
			id: "work",
			type: "value",
			position: at,
			by: "model",
			prompt: READS,
			output: {
				type: "object",
				properties: { tasks: { type: "array" } },
				required: ["tasks"],
			},
			cascade: [
				{ label: "small", decider: "ollama" },
				{ label: "big", decider: "openrouter" },
				...(person ? [PERSON] : []),
			],
		}) satisfies ValueNode,
	setup: (holds) => {
		const calls: ValueInput[] = [];
		const decider: Decider = {
			defaultModel: defaultDeciderModel,
			async decide() {
				throw new Error("A Value asks for a value, not a pick.");
			},
			async value(input): Promise<ValueResult> {
				calls.push(input);
				const fits = holds[calls.length - 1] === true;
				return {
					kind: "made",
					data: fits ? { tasks: ["a"] } : { nope: calls.length },
					costUsd: 0,
				};
			},
		};
		return {
			options: { decider },
			reads: async () => calls.map((call) => call.prompt),
		};
	},
};

/** The steps of the node with the cascade, in the run's own flow, oldest first. */
async function steps(h: Harness) {
	return deriveSteps(foldRun(await h.events()))
		.filter((step) => step.nodeId === "work" && step.scope === null)
		.sort((a, b) => a.visit - b.visit);
}

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

describe.each([AGENT, SUBFLOW, DECISION, VALUE])(
	"a $label that climbs its cascade",
	(kind) => {
		const start = (person: boolean, holds: boolean[]) => {
			const { options, reads } = kind.setup(holds);
			const flow = flowOf({
				start: "work",
				nodes: [kind.node(person), command("after", "true")],
				edges: [{ id: "e1", from: "work", outcome: kind.holds, to: "after" }],
			});
			return startRun(sandbox, flow, options).then((h) => ({ h, reads }));
		};

		test("a try that does not hold climbs: each try is a step with its tier, and reads the try before", async () => {
			const { h, reads } = await start(false, [false, true]);
			const { parked, state } = await drive(h, { inputs: {} });
			expect(parked).toEqual([]);
			expect(state.ended?.nodeId).toBe("after");
			expect(await reads(h)).toEqual([
				"Try 1 on small after .",
				"Try 1 on big after fail.",
			]);
			const tries = await steps(h);
			expect(
				tries.map((step) => [
					step.visit,
					step.outcome,
					step.outputs.tier,
					step.outputs.tries,
				]),
			).toEqual([
				[1, "fail", "small", 1],
				[2, kind.holds, "big", 2],
			]);
			expect(tries.map((step) => step.rung)).toEqual([
				{ by: kind.by, tier: 0 },
				{ by: kind.by, tier: 1, last: true },
			]);
			expect(state.nodes.work).toMatchObject({ tier: "big", tries: 2 });
			// The climb is done: the next visit starts at the first tier.
			expect(state.cascades?.work).toBeNull();
		});

		test("without a tier left, the step ends on the last try, with its tier", async () => {
			const { h } = await start(false, [false, false]);
			const { parked, state } = await drive(h, { inputs: {} });
			expect(parked[0]).toMatchObject({
				kind: "parked",
				nodeId: "work",
				status: "failed",
			});
			expect((await steps(h)).map((step) => step.outcome)).toEqual([
				"fail",
				"fail",
			]);
			expect(state.nodes.work).toMatchObject({
				outcome: "fail",
				tier: "big",
				tries: 2,
			});
		});

		test("the person tier is a Gate on a step of its own: no timers, marked as the climb's, and it reads the climb", async () => {
			const { h } = await start(true, [false, false]);
			const { state } = await drive(h, { inputs: {} });
			expect(held(state)).toMatchObject({
				kind: "gate",
				nodeId: "work",
				climb: true,
				outputs: expect.objectContaining({ tier: "person", tries: 3 }),
			});
			const events = await h.events();
			const started = payloads(events, "StepStarted").filter(
				(step) => step.nodeId === "work",
			);
			expect(started.map((step) => step.rung)).toEqual([
				{ by: kind.by, tier: 0 },
				{ by: kind.by, tier: 1 },
				{ by: "person", tier: 2, last: true },
			]);
			expect(started[2]?.timeoutMs).toBeUndefined();
			const [opened] = payloads(events, "GateOpened");
			expect(opened?.brief?.situation).toBe("big did not hold.");
		});

		test("a position past the last tier throws with the node's label", () => {
			const action = climbing(kind.node(false), {} as StepContext, {
				person: () => {
					throw new Error("No person tier here.");
				},
				attempt: () => {
					throw new Error("No try here.");
				},
			});
			const state = {
				cascades: { work: { tier: 2, try: 1, trail: [] } },
			} as unknown as RunStateValues;
			expect(() => action(state, {} as LangGraphRunnableConfig)).toThrow(
				`${kind.label} node "work" has no tier 3 in its cascade.`,
			);
		});
	},
);
