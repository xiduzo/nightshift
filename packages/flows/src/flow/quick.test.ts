import { describe, expect, test } from "bun:test";
import { validateFlow } from "../validate";
import { FLOW_VERSION, flowSchema } from "./flow";
import { singleAgentFlow } from "./quick";

describe("singleAgentFlow", () => {
	test("builds a valid one-node flow", () => {
		const flow = singleAgentFlow({
			prompt: "Fix the flaky test",
			model: "sonnet",
			permissionMode: "acceptEdits",
		});
		expect(flow).toEqual({
			version: FLOW_VERSION,
			inputs: [],
			outputs: [],
			start: "agent",
			nodes: [
				{
					id: "agent",
					type: "agent",
					position: { x: 0, y: 0 },
					prompt: "Fix the flaky test",
					harness: "claude-code",
					model: "sonnet",
					permissionMode: "acceptEdits",
					session: "fresh",
				},
			],
			edges: [],
		});
		expect(flowSchema.parse(flow)).toEqual(flow);
		expect(validateFlow(flow)).toEqual([]);
	});

	test("keeps effort and skill when given", () => {
		const flow = singleAgentFlow({
			prompt: "",
			model: "opus",
			permissionMode: "plan",
			effort: "high",
			skill: "review",
		});
		expect(flow.nodes[0]).toMatchObject({ effort: "high", skill: "review" });
		expect(validateFlow(flow)).toEqual([]);
	});

	test("leaves out effort and skill when not given", () => {
		const node = singleAgentFlow({
			prompt: "x",
			model: "sonnet",
			permissionMode: "default",
		}).nodes[0];
		expect(node).not.toHaveProperty("effort");
		expect(node).not.toHaveProperty("skill");
	});

	test("runs an Agent Profile, with only the overrides given", () => {
		const node = singleAgentFlow({
			prompt: "x",
			profile: "worker",
			model: "opus",
			permissionMode: "acceptEdits",
		}).nodes[0];
		expect(node).toMatchObject({ profile: "worker", model: "opus" });
		expect(node).not.toHaveProperty("harness");
	});

	test("takes another harness without a profile", () => {
		const flow = singleAgentFlow({
			prompt: "x",
			harness: "codex",
			model: "gpt-5.1-codex",
			permissionMode: "acceptEdits",
		});
		expect(flow.nodes[0]).toMatchObject({ harness: "codex" });
		expect(validateFlow(flow)).toEqual([]);
	});

	test("refuses an agent with neither a profile nor a model", () => {
		expect(() =>
			singleAgentFlow({ prompt: "x", permissionMode: "acceptEdits" }),
		).toThrow();
	});
});
