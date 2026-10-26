import { describe, expect, test } from "bun:test";
import { chatRequestSchema, suggestionRequestSchema } from "./assistant";

const flow = {
	version: 6,
	start: "plan",
	nodes: [
		{
			id: "plan",
			type: "agent",
			position: { x: 0, y: 0 },
			profile: "worker",
			prompt: "Plan.",
		},
	],
	edges: [],
};
const base = { projectId: "p1", flowName: "fix", flow, message: "Hi." };

describe("the agent of a request", () => {
	test("nothing, a profile with overrides, or a harness and a model", () => {
		for (const agent of [
			{},
			{ profile: "worker" },
			{ profile: "worker", model: "haiku", effort: "low" },
			{ harness: "claude-code", model: "haiku" },
			{ harness: "acp:goose", model: "default", effort: "high" },
		]) {
			expect(chatRequestSchema.safeParse({ ...base, ...agent }).success).toBe(
				true,
			);
		}
	});

	test("without a profile, the harness and the model go together", () => {
		for (const agent of [
			{ harness: "claude-code" },
			{ model: "haiku" },
			{ effort: "low" },
		]) {
			const parsed = suggestionRequestSchema.safeParse({
				...base,
				nodeId: "plan",
				kind: "prompt",
				...agent,
			});
			expect(parsed.success).toBe(false);
			expect(parsed.error?.issues[0]?.message).toBe(
				"Choose a profile, or a harness and a model.",
			);
		}
	});
});
