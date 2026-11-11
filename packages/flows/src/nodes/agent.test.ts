import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow, flowSchema } from "../flow";
import { validateFlow } from "../validate/flow";
import { type AgentNode, knowledgeFolderPath } from "./agent";

function flowWith(knowledge: AgentNode["knowledge"]): Flow {
	return {
		version: FLOW_VERSION,
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

	test("an empty list is not valid: Never gives no knowledge", () => {
		expect(errors(flowWith([]))).toEqual([
			'Agent node "reader" lists no knowledge folders. Pick at least one, or choose Never to give the agent no knowledge.',
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

describe("the backups of a node's profile (ADR 19)", () => {
	const issuesOf = (extra: Record<string, unknown>) => {
		const flow = flowSchema.parse({
			version: FLOW_VERSION,
			start: "a",
			nodes: [
				{
					id: "a",
					type: "agent",
					position: { x: 0, y: 0 },
					prompt: "Work.",
					...extra,
				},
			],
			edges: [],
		});
		return validateFlow(flow).map((issue) => issue.message);
	};
	const own = { device: "mac", profile: "builder" };
	const backup = { device: "host", profile: "builder" };

	test("a profile with another profile as its backup passes", () => {
		expect(issuesOf({ profile: own, fallbacks: [backup] })).toEqual([]);
	});

	test("a backup without a profile of its own does not pass", () => {
		expect(
			issuesOf({
				harness: "claude-code",
				model: "m",
				permissionMode: "auto",
				fallbacks: [backup],
			}).join(" "),
		).toContain("no profile of its own");
	});

	test("a backup that repeats a profile does not pass", () => {
		expect(issuesOf({ profile: own, fallbacks: [own] }).join(" ")).toContain(
			"the same profile more than once",
		);
	});

	test("a cascade has no backups: its next tier is the backup", () => {
		expect(
			issuesOf({
				cascade: [{ profile: own }, { profile: backup }],
				fallbacks: [backup],
			}).join(" "),
		).toContain("The next tier is the backup");
	});
});
