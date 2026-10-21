import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow, flowSchema } from "../document";
import { type AgentNode, agentHarnessSchema } from "../nodes";
import { validateFlow } from "../validate";
import {
	type AgentProfileSettings,
	agentProfileSettingsSchema,
	resolveAgentNode,
	resolvedAgent,
	resolveFlowProfiles,
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

function flowOf(...nodes: AgentNode[]): Flow {
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
