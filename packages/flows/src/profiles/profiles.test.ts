import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow, flowSchema } from "../document";
import {
	type AgentNode,
	agentHarnessSchema,
	type DecisionNode,
	type ValueNode,
} from "../nodes";
import { validateFlow } from "../validate";
import { parseProfilesSource } from "./file";
import {
	type AgentProfileSettings,
	agentProfileSettingsSchema,
	type ModelProfileSettings,
	profileSettingsSchema,
	resolveAgentNode,
	resolvedAgent,
	resolveFlowProfiles,
	resolveModelNode,
	resolveNodeProfile,
} from "./profiles";

const builder: AgentProfileSettings = {
	harness: "opencode",
	model: "openai/gpt-5.2",
	effort: "high",
	permissionMode: "auto",
	clis: ["gh"],
	connections: ["playwright"],
};

function node(extra: Partial<AgentNode> = {}): AgentNode {
	return {
		id: "work",
		type: "agent",
		position: { x: 0, y: 0 },
		prompt: "Do the work",
		profile: "builder",
		session: "fresh",
		...extra,
	};
}

const triage: ModelProfileSettings = {
	decider: "openrouter",
	model: "~typesafe/jev-latest",
};

function decision(extra: Partial<DecisionNode> = {}): DecisionNode {
	return {
		id: "pick",
		type: "decision",
		position: { x: 0, y: 0 },
		prompt: "Is it green?",
		options: [{ name: "yes" }, { name: "no" }],
		by: "model",
		profile: "triage",
		...extra,
	};
}

function value(extra: Partial<ValueNode> = {}): ValueNode {
	return {
		id: "plan",
		type: "value",
		position: { x: 0, y: 0 },
		by: "model",
		prompt: "List the tasks.",
		output: { type: "object" },
		profile: "triage",
		...extra,
	};
}

function flowOf(...nodes: (AgentNode | DecisionNode | ValueNode)[]): Flow {
	return {
		version: FLOW_VERSION,
		inputs: [],
		outputs: [],
		start: nodes[0]?.id ?? "work",
		nodes,
		edges: [],
	};
}

describe("resolveAgentNode", () => {
	test("takes the harness, model, effort, permission mode, CLI tools and connections of the profile", () => {
		const resolved = resolveAgentNode(node(), builder);
		expect(resolved).toMatchObject({
			profile: "builder",
			harness: "opencode",
			model: "openai/gpt-5.2",
			effort: "high",
			permissionMode: "auto",
			clis: ["gh"],
			connections: ["playwright"],
		});
		expect(resolvedAgent(resolved)).not.toBeNull();
	});

	test("a field the node sets wins; CLI tools and connections add up", () => {
		const resolved = resolveAgentNode(
			node({
				model: "openai/gpt-5.1-codex",
				clis: ["aws", "gh"],
				connections: ["linear"],
			}),
			builder,
		);
		expect(resolved.model).toBe("openai/gpt-5.1-codex");
		expect(resolved.harness).toBe("opencode");
		expect(resolved.clis).toEqual(["gh", "aws"]);
		expect(resolved.connections).toEqual(["playwright", "linear"]);
	});

	test("a profile without effort or connections leaves them out", () => {
		const resolved = resolveAgentNode(node(), {
			...builder,
			effort: undefined,
			connections: [],
		});
		expect("effort" in resolved).toBe(false);
		expect("connections" in resolved).toBe(false);
	});
});

describe("resolveFlowProfiles", () => {
	test("collects the profiles it cannot find, with their nodes", () => {
		const missing = new Map<string, string[]>();
		const flow = flowOf(node(), node({ id: "review", profile: "reviewer" }));
		const resolved = resolveFlowProfiles(
			flow,
			(name) => (name === "builder" ? builder : null),
			missing,
		);
		expect([...missing]).toEqual([["reviewer", ["review"]]]);
		expect(resolved.nodes[0]).toMatchObject({ harness: "opencode" });
		expect(resolved.nodes[1]).toEqual(flow.nodes[1] as AgentNode);
	});

	test("a flow without profiles comes back as it was", () => {
		const flow = flowOf(
			node({
				profile: undefined,
				harness: "claude-code",
				model: "sonnet",
				permissionMode: "auto",
			}),
		);
		expect(resolveFlowProfiles(flow, () => builder)).toBe(flow);
	});
});

describe("validateFlow and profiles", () => {
	test("a node with a profile needs no harness or model of its own", () => {
		const issues = validateFlow(flowOf(node()));
		expect(issues.filter((i) => i.severity === "error")).toEqual([]);
	});

	test("a node without a profile needs a harness, a model and a permission mode", () => {
		const issues = validateFlow(flowOf(node({ profile: undefined })));
		expect(issues.map((i) => i.message)).toContain(
			'Agent node "work" needs a profile, or its own harness, model and permission mode.',
		);
	});
});

describe("custom agents in a flow", () => {
	test("a node or a profile may name a custom agent as acp:<slug>", () => {
		const flow = flowOf(
			node({
				profile: undefined,
				harness: "acp:goose",
				model: "default",
				permissionMode: "auto",
			}),
		);
		expect(flowSchema.safeParse(flow).success).toBe(true);
		expect(validateFlow(flow).filter((i) => i.severity === "error")).toEqual(
			[],
		);
		expect(
			agentProfileSettingsSchema.safeParse({ ...builder, harness: "acp:kimi" })
				.success,
		).toBe(true);
	});

	test.each(["acp:", "acp:Goose", "acp:goose agent", "goose"])(
		"%s is not a harness",
		(harness) => {
			expect(agentHarnessSchema.safeParse(harness).success).toBe(false);
		},
	);
});

describe("model profiles", () => {
	test("a settings object with a decider is a model profile, one with a harness an agent profile", () => {
		expect(profileSettingsSchema.parse(triage)).toEqual(triage);
		expect(profileSettingsSchema.parse({ decider: "ollama" })).toEqual({
			decider: "ollama",
		});
		expect(profileSettingsSchema.parse(builder)).toEqual(builder);
		expect(profileSettingsSchema.safeParse({ model: "x" }).success).toBe(false);
	});

	test("a Decision takes the decider and the model of its profile", () => {
		expect(resolveModelNode(decision(), triage)).toMatchObject({
			profile: "triage",
			decider: "openrouter",
			model: "~typesafe/jev-latest",
		});
	});

	test("the node's own decider wins, and then the profile's model does not fit it", () => {
		const resolved = resolveModelNode(decision({ decider: "ollama" }), triage);
		expect(resolved.decider).toBe("ollama");
		expect("model" in resolved).toBe(false);
		expect(
			resolveModelNode(decision({ model: "typesafe/jev-1.13" }), triage).model,
		).toBe("typesafe/jev-1.13");
	});

	test("a profile without a model leaves the decider's default", () => {
		const resolved = resolveModelNode(value(), { decider: "openai" });
		expect(resolved.decider).toBe("openai");
		expect("model" in resolved).toBe(false);
	});

	test("a profile of the wrong kind does not fit its node", () => {
		expect(resolveNodeProfile(node(), triage)).toEqual({
			problem:
				'The Agent node "work" names the profile "builder", which is for Decision and Value nodes. Pick an agent profile.',
		});
		expect(resolveNodeProfile(decision(), builder)).toEqual({
			problem:
				'The Decision node "pick" names the profile "triage", which is for Agent nodes. Pick a model profile.',
		});
	});

	test("a Value needs a profile whose decider makes values", () => {
		const result = resolveNodeProfile(value(), { decider: "typesafe" });
		expect("problem" in result && result.problem).toContain(
			"whose decider cannot make a value",
		);
		expect(resolveNodeProfile(value(), triage)).toEqual({
			node: {
				...value(),
				decider: "openrouter",
				model: "~typesafe/jev-latest",
			},
		});
	});

	test("resolveFlowProfiles resolves Decisions and Values by model, and reports a misfit", () => {
		const problems: string[] = [];
		const flow = flowOf(
			node(),
			decision(),
			decision({ id: "gate", by: "person", profile: undefined }),
			value({ id: "agentish", profile: "builder" }),
		);
		const resolved = resolveFlowProfiles(
			flow,
			(name) =>
				name === "builder" ? builder : name === "triage" ? triage : null,
			new Map(),
			problems,
		);
		expect(resolved.nodes[0]).toMatchObject({ harness: "opencode" });
		expect(resolved.nodes[1]).toMatchObject({ decider: "openrouter" });
		expect(resolved.nodes[2]).toBe(flow.nodes[2] as DecisionNode);
		expect(problems).toEqual([
			'The Value node "agentish" names the profile "builder", which is for Agent nodes. Pick a model profile.',
		]);
	});

	test("only a model reads a profile", () => {
		const issues = validateFlow(
			flowOf(
				decision({ by: "person" }),
				value({ id: "rule", by: "rule", expression: "1" }),
			),
		).map((i) => i.message);
		expect(issues).toContain(
			'Decision node "pick" names the profile "triage", but you decide it. Only a model reads a profile. Remove the profile, or let a model decide.',
		);
		expect(issues).toContain(
			'Value node "rule" names the profile "triage", but a rule makes it. Only a model reads a profile. Remove the profile, or let a model make it.',
		);
	});

	test("a Value with a profile and no decider of its own is valid: the run checks the profile", () => {
		const issues = validateFlow(flowOf(value()));
		expect(issues.filter((i) => i.severity === "error")).toEqual([]);
	});
});

describe("a project's profiles file", () => {
	test("no file is no profiles", () => {
		expect(parseProfilesSource(null)).toEqual({ profiles: [], issues: [] });
	});

	test("reads both kinds; a bad entry and a repeated name are left out with an error", () => {
		const read = parseProfilesSource({
			json: {
				version: 1,
				profiles: [
					{ name: "builder", ...builder },
					{ name: "triage", ...triage, description: "Small calls" },
					{ name: "broken", harness: "claude-code" },
					{ name: "triage", decider: "ollama" },
				],
			},
		});
		expect(read.profiles.map((p) => p.name)).toEqual(["builder", "triage"]);
		expect(read.issues).toEqual([
			{
				severity: "error",
				message:
					'The profile "broken" is not valid. It needs a name, and either a harness, a model and a permission mode (for Agent nodes) or a decider (for Decision and Value nodes).',
				profile: "broken",
			},
			{
				severity: "error",
				message: 'Two profiles are named "triage". Give each its own name.',
				profile: "triage",
			},
		]);
	});

	test("a file that is not JSON, or has another version, has no profiles", () => {
		expect(parseProfilesSource({ jsonError: "Unexpected token" })).toEqual({
			profiles: [],
			issues: [
				{ severity: "error", message: "Not valid JSON: Unexpected token" },
			],
		});
		const read = parseProfilesSource({ json: { version: 2, profiles: [] } });
		expect(read.profiles).toEqual([]);
		expect(read.issues[0]?.message).toStartWith("version:");
	});
});
