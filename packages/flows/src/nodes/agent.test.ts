import { describe, expect, test } from "bun:test";
import type { Flow } from "../flow";
import { flowSchema } from "../flow";
import { validateFlow } from "../validate/flow";
import { type AgentNode, knowledgeFolderPath } from "./agent";

function flowWith(knowledge: AgentNode["knowledge"]): Flow {
	return {
		version: 7,
		inputs: [],
		outputs: [],
		start: "reader",
		nodes: [
			{
				id: "reader",
				type: "agent",
				position: { x: 0, y: 0 },
				prompt: "Replicate the paper.",
				harness: "claude-code",
				model: "sonnet",
				permissionMode: "auto",
				session: "fresh",
				...(knowledge !== undefined ? { knowledge } : {}),
			},
		],
		edges: [],
	};
}

const errors = (flow: Flow) =>
	validateFlow(flow)
		.filter((issue) => issue.severity === "error")
		.map((issue) => issue.message);

describe("an Agent node's knowledge folders", () => {
	test("a list of folders is valid, and so are true, false and unset", () => {
		for (const knowledge of [
			undefined,
			true,
			false,
			["books", "learnings/accepted", "research/papers/2013-gem.md"],
		]) {
			const flow = flowWith(knowledge);
			expect(flowSchema.safeParse(flow).success).toBe(true);
			expect(errors(flow)).toEqual([]);
		}
	});

	test("an empty list is not valid: false gives no knowledge", () => {
		expect(errors(flowWith([]))).toEqual([
			'Agent node "reader" lists no knowledge folders. Use false to give the agent no knowledge.',
		]);
	});

	test("a folder outside the knowledge is not valid", () => {
		for (const folder of [
			"",
			"/etc",
			"../secrets",
			"books/../results",
			".git",
		]) {
			expect(errors(flowWith(["books", folder]))).toEqual([
				`Agent node "reader" lists "${folder}" as a knowledge folder. Give a folder inside the knowledge, for example books or research/papers.`,
			]);
		}
	});

	test("a folder as a person types it is made plain", () => {
		expect(knowledgeFolderPath(" ./books/ ")).toBe("books");
		expect(knowledgeFolderPath("research/papers")).toBe("research/papers");
		expect(knowledgeFolderPath("books//x")).toBeNull();
		expect(knowledgeFolderPath("books\\x")).toBeNull();
		expect(knowledgeFolderPath("/books")).toBeNull();
	});
});
