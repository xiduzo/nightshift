import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow, type FlowNode } from "../flow";
import type { AgentNode, CallNode } from "../nodes";
import { starterAgents } from "../starters";
import { validateFlow } from "../validate";
import {
	agentKey,
	type FlowAgent,
	flowAgents,
	prefilledProfile,
	withAgentProfiles,
} from "./flow-agents";

const at = { x: 0, y: 0 };

function agent(id: string, extra: Partial<AgentNode> = {}): AgentNode {
	return {
		id,
		type: "agent",
		position: at,
		prompt: "Do the work",
		harness: "claude-code",
		model: "sonnet",
		permissionMode: "auto",
		session: "fresh",
		...extra,
	};
}

function call(
	id: string,
	flow: string,
	extra: Partial<CallNode> = {},
): CallNode {
	return { id, type: "call", position: at, flow, inputs: {}, ...extra };
}

function flowOf(...nodes: FlowNode[]): Flow {
	return {
		version: FLOW_VERSION,
		inputs: [],
		outputs: [],
		start: nodes[0]?.id ?? "start",
		nodes,
		edges: [],
	};
}

/** A cascade like the starter implement-and-check: Sonnet, then Opus, then a person. */
const climbing = agent("implement", {
	harness: undefined,
	model: undefined,
	effort: "high",
	cascade: [
		{ label: "sonnet", harness: "claude-code", model: "sonnet", tries: 3 },
		{ label: "opus", harness: "claude-code", model: "opus" },
		{ person: true },
	],
	check: "bun test",
});

const sonnet: FlowAgent = { harness: "claude-code", model: "sonnet" };
const opus: FlowAgent = { harness: "claude-code", model: "opus" };
const codex = { device: "mac", profile: "codex-builder" };
const pi = { device: "mac", profile: "pi-local" };

describe("the agents of a flow", () => {
	test("each Agent node's harness and model, once, in the order they appear", () => {
		const flow = flowOf(
			agent("plan"),
			agent("build", { model: "opus" }),
			agent("review"),
		);
		expect(flowAgents([flow])).toEqual([sonnet, opus]);
	});

	test("each model tier of a cascade, and no person tier", () => {
		expect(flowAgents([flowOf(climbing)])).toEqual([sonnet, opus]);
	});

	test("a node or a tier that names a profile is no agent to choose", () => {
		const flow = flowOf(
			agent("mine", { harness: undefined, model: undefined, profile: codex }),
			agent("tiered", {
				harness: undefined,
				model: undefined,
				cascade: [
					{ profile: pi },
					{ harness: "codex", model: "gpt-5", permissionMode: "auto" },
				],
			}),
		);
		expect(flowAgents([flow])).toEqual([{ harness: "codex", model: "gpt-5" }]);
	});

	test("the flows a Call runs, by name, when the flows of the project are given", () => {
		const build = flowOf(agent("build", { model: "opus" }));
		const review = flowOf(
			agent("review", { harness: "codex", model: "gpt-5" }),
		);
		const plan = flowOf(
			agent("plan"),
			call("each", "build"),
			call("check", "build", {
				cascade: [{ flow: "review" }, { person: true }],
			}),
			call("publish", "kit:github/publish-draft-pr"),
		);
		expect(flowAgents([plan])).toEqual([sonnet]);
		expect(flowAgents([plan], { build, review, broken: null })).toEqual([
			sonnet,
			opus,
			{ harness: "codex", model: "gpt-5" },
		]);
	});

	test("a flow that calls itself is read once", () => {
		const loop = flowOf(agent("work"), call("again", "loop"));
		expect(flowAgents([loop], { loop })).toEqual([sonnet]);
	});

	test("the starters name Claude Code with Sonnet and Opus", () => {
		expect(starterAgents()).toEqual([sonnet, opus]);
	});

	test("a key names the harness and the model, as a terminal types it", () => {
		expect(agentKey(sonnet)).toBe("claude-code:sonnet");
		expect(agentKey({ harness: "acp:goose", model: "default" })).toBe(
			"acp:goose:default",
		);
	});
});

describe("the profile that takes an agent before the person chooses", () => {
	const profiles = [
		{ id: "fast", harness: "codex", model: "gpt-5-mini" },
		{ id: "deep", harness: "claude-code", model: "opus" },
		{ id: "quick", harness: "claude-code", model: "haiku" },
		{ id: "sonnet", harness: "claude-code", model: "sonnet" },
	];

	test("the same harness and model", () => {
		expect(prefilledProfile(sonnet, profiles)?.id).toBe("sonnet");
		expect(prefilledProfile(opus, profiles)?.id).toBe("deep");
	});

	test("else the first with the same harness", () => {
		expect(
			prefilledProfile({ harness: "claude-code", model: "fable" }, profiles)
				?.id,
		).toBe("deep");
	});

	test("else the first profile, and none without profiles", () => {
		expect(
			prefilledProfile({ harness: "pi", model: "qwen3:32b" }, profiles)?.id,
		).toBe("fast");
		expect(prefilledProfile(sonnet, [])).toBeUndefined();
	});
});

describe("a flow on the profiles the person chose", () => {
	test("an Agent node names the profile, without its harness, model and device", () => {
		const flow = flowOf(
			agent("build", { device: "laptop", effort: "high", clis: ["gh"] }),
			agent("review", { model: "opus" }),
		);
		const mapped = withAgentProfiles(flow, [{ agent: sonnet, profile: codex }]);
		expect(mapped.nodes).toEqual([
			{
				id: "build",
				type: "agent",
				position: at,
				prompt: "Do the work",
				permissionMode: "auto",
				session: "fresh",
				effort: "high",
				clis: ["gh"],
				profile: codex,
			},
			agent("review", { model: "opus" }),
		]);
		expect(validateFlow(mapped).filter((i) => i.severity === "error")).toEqual(
			[],
		);
	});

	test("each tier of a cascade names its own profile, and the node no device", () => {
		const flow = flowOf({ ...climbing, device: "laptop" });
		const mapped = withAgentProfiles(flow, [
			{ agent: sonnet, profile: codex },
			{ agent: opus, profile: pi },
		]);
		const [node] = mapped.nodes as [AgentNode];
		expect(node.device).toBeUndefined();
		expect(node.effort).toBe("high");
		expect(node.cascade).toEqual([
			{ label: "sonnet", tries: 3, profile: codex },
			{ label: "opus", profile: pi },
			{ person: true },
		]);
		expect(validateFlow(mapped).filter((i) => i.severity === "error")).toEqual(
			[],
		);
	});

	test("an agent without a choice keeps its harness and model", () => {
		const flow = flowOf(climbing);
		const mapped = withAgentProfiles(flow, [{ agent: opus, profile: pi }]);
		const [node] = mapped.nodes as [AgentNode];
		expect(node.cascade?.[0]).toEqual(climbing.cascade?.[0]);
		expect(node.cascade?.[1]).toEqual({ label: "opus", profile: pi });
	});

	test("a node that names a profile stays, and no choice gives the same flow", () => {
		const flow = flowOf(
			agent("mine", { harness: undefined, model: undefined, profile: codex }),
			call("each", "build"),
		);
		expect(withAgentProfiles(flow, [{ agent: sonnet, profile: pi }])).toBe(
			flow,
		);
		expect(withAgentProfiles(flowOf(agent("build")), [])).toEqual(
			flowOf(agent("build")),
		);
	});
});
