import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow, flowSchema } from "../flow";
import {
	type AgentNode,
	agentHarnessSchema,
	type DecisionNode,
	type ValueNode,
} from "../nodes";
import { validateFlow } from "../validate";
import {
	type AgentProfileSettings,
	agentProfileSettingsSchema,
	type ModelProfileSettings,
	modelAddressProblem,
	modelProfileSettingsSchema,
	profileLabel,
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
		profile: { device: "mac", profile: "builder" },
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
		profile: { device: "mac", profile: "triage" },
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
		profile: { device: "mac", profile: "triage" },
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
			profile: { device: "mac", profile: "builder" },
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
		const flow = flowOf(
			node(),
			node({ id: "review", profile: { device: "mac", profile: "reviewer" } }),
		);
		const resolved = resolveFlowProfiles(
			flow,
			(profile) => (profileLabel(profile) === "builder" ? builder : null),
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

	test("a profile name left from format 6 runs nowhere: pick the profile again", () => {
		const issues = validateFlow(flowOf(node({ profile: "builder" })));
		expect(issues.map((i) => i.message)).toContain(
			`Agent node "work" names the profile "builder", but Night Shift cannot tell which computer's profile it is. Pick the profile again.`,
		);
	});

	test("a node with a profile names no device: the profile's device runs it", () => {
		const issues = validateFlow(flowOf(node({ device: "LE2316" })));
		expect(issues.map((i) => i.message)).toContain(
			'Agent node "work" names a device and a profile. The step runs on the profile\'s device. Remove the device, or the profile.',
		);
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
			profile: { device: "mac", profile: "triage" },
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
			value({ id: "agentish", profile: { device: "mac", profile: "builder" } }),
		);
		const resolved = resolveFlowProfiles(
			flow,
			(profile) =>
				profileLabel(profile) === "builder"
					? builder
					: profileLabel(profile) === "triage"
						? triage
						: null,
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
			'Decision node "pick" names a profile, but you decide it. Only a model reads a profile. Remove the profile, or let a model decide.',
		);
		expect(issues).toContain(
			'Value node "rule" names a profile, but a rule makes it. Only a model reads a profile. Remove the profile, or let a model make it.',
		);
	});

	test("a Value with a profile and no decider of its own is valid: the run checks the profile", () => {
		const issues = validateFlow(flowOf(value()));
		expect(issues.filter((i) => i.severity === "error")).toEqual([]);
	});
});

describe("the address of a model profile", () => {
	const remote: ModelProfileSettings = {
		decider: "ollama",
		model: "qwen3:4b",
		address: {
			baseUrl: "http://gpu-box:11434",
			// biome-ignore lint/suspicious/noTemplateCurlyInString: a secret reference, as a person writes it.
			headers: { "X-Proxy-Key": "${PROXY_KEY}" },
		},
	};

	test("an address is a base URL, the secret of its API key, and headers", () => {
		expect(
			modelProfileSettingsSchema.parse({
				decider: "openai",
				address: { baseUrl: " http://openjev:8080/v1 ", apiKey: "OPENJEV_KEY" },
			}).address,
		).toEqual({ baseUrl: "http://openjev:8080/v1", apiKey: "OPENJEV_KEY" });
		for (const address of [
			{ baseUrl: "openjev:8080" },
			{ baseUrl: "ftp://openjev" },
			{ baseUrl: "http://openjev:8080/?key=1" },
			{ baseUrl: "http://openjev:8080", apiKey: "not a name" },
			{ baseUrl: "http://openjev:8080", headers: { "bad header": "x" } },
		]) {
			expect(
				modelProfileSettingsSchema.safeParse({ decider: "openai", address })
					.success,
			).toBe(false);
		}
	});

	test("a vendor API takes no address", () => {
		expect(modelAddressProblem(remote)).toBeNull();
		expect(modelAddressProblem({ decider: "openai" })).toBeNull();
		expect(
			modelAddressProblem({
				decider: "typesafe",
				address: { baseUrl: "http://openjev:8080" },
			}),
		).toBe(
			'The decider "typesafe" always uses its own service, so it takes no address. Remove the address, or choose another decider.',
		);
	});

	test("a node takes the address of its profile, with the profile's decider only", () => {
		expect(resolveModelNode(decision(), remote).address).toEqual(
			remote.address,
		);
		expect(
			"address" in resolveModelNode(decision({ decider: "openai" }), remote),
		).toBe(false);
	});

	test("OpenJev and an OpenAI-compatible server need an address", () => {
		expect(modelAddressProblem({ decider: "openjev" })).toBe(
			'The decider "openjev" needs an address. Add the address of its server.',
		);
		expect(
			modelAddressProblem({
				decider: "compatible",
				address: { baseUrl: "http://127.0.0.1:1234/v1" },
			}),
		).toBeNull();
		const problem = resolveNodeProfile(decision({ decider: "openjev" }), {
			decider: "typesafe",
		});
		expect("problem" in problem && problem.problem).toBe(
			'The Decision node "pick" uses the decider "openjev", which needs an address, but the profile "triage" has none for it. Pick a profile on openjev with an address.',
		);
		const issues = validateFlow(
			flowOf(decision({ profile: undefined, decider: "openjev" })),
		).map((issue) => issue.message);
		expect(issues).toContain(
			'Decision node "pick" uses the decider "openjev", which needs an address. Pick a Model Profile on openjev that has one.',
		);
	});

	test("an OpenAI-compatible server makes a value, OpenJev does not", () => {
		const at = { baseUrl: "http://127.0.0.1:1234" };
		expect(
			"node" in
				resolveNodeProfile(value(), { decider: "compatible", address: at }),
		).toBe(true);
		expect(
			"problem" in
				resolveNodeProfile(value(), { decider: "openjev", address: at }),
		).toBe(true);
	});

	test("a flow does not set an address: the profile has it", () => {
		const issues = validateFlow(
			flowOf(
				decision({ address: { baseUrl: "http://openjev:8080" } }),
				value({ address: { baseUrl: "http://openjev:8080" } }),
			),
		).map((issue) => issue.message);
		expect(issues).toContain(
			'Decision node "pick" sets an address. Put the address on a Model Profile, and pick that profile.',
		);
		expect(issues).toContain(
			'Value node "plan" sets an address. Put the address on a Model Profile, and pick that profile.',
		);
	});
});
