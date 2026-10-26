import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type Flow,
	flowSchema,
	type SuggestionRequest,
	suggestionRequestSchema,
} from "@nightshift/flows";
import { readProjectFacts } from "./project-facts";
import {
	cannotSuggest,
	checkSuggestion,
	suggestionDataSchema,
} from "./suggest";
import { suggestionPrompt } from "./suggestion-prompt";

const flow: Flow = flowSchema.parse({
	version: 6,
	start: "review",
	inputs: [{ name: "pr", type: "text" }],
	nodes: [
		{
			id: "review",
			type: "agent",
			position: { x: 0, y: 0 },
			profile: "worker",
			prompt: "Review {{pr}} and say if it can merge.",
			checker: { decider: "typesafe" },
		},
		{
			id: "gate",
			type: "decision",
			position: { x: 0, y: 0 },
			prompt: "",
			by: "rule",
			options: [
				{ name: "ship", when: "review.outcome = 'pass'" },
				{ name: "hold" },
			],
		},
		{
			id: "check",
			type: "command",
			position: { x: 0, y: 0 },
			command: "npm test",
		},
		{
			id: "issue",
			type: "tool",
			position: { x: 0, y: 0 },
			connection: "linear",
			tool: "create_issue",
			arguments: {},
		},
		{
			id: "traces",
			type: "call",
			position: { x: 0, y: 0 },
			flow: "trace",
			each: {
				source: { kind: "command", command: "cat tasks.json" },
				as: "task",
			},
		},
		{
			id: "notify",
			type: "agent",
			position: { x: 0, y: 0 },
			profile: "worker",
			prompt: "Tell {{owner}} about {{gate.outcome}}.",
		},
	],
	edges: [
		{ id: "e1", from: "review", outcome: "pass", to: "gate" },
		{ id: "e2", from: "gate", outcome: "ship", to: "check" },
	],
});

function request(overrides: Partial<SuggestionRequest>): SuggestionRequest {
	return suggestionRequestSchema.parse({
		projectId: "p1",
		flowName: "review",
		flow,
		...overrides,
	});
}

describe("each kind gets its own task and context", () => {
	test("outcomes: the prompt, where the flow goes next, and who reads the outcome", () => {
		const text = suggestionPrompt(
			request({ nodeId: "gate", kind: "outcomes" }),
		);
		expect(text).toContain("Suggest outcomes for one node.");
		expect(text).toContain("on `ship` → `check` (command)");
		expect(text).toContain("`notify`");
		expect(text).toContain("A rule picks one");
	});

	test("rules: the options with their rules, and the rule syntax", () => {
		const text = suggestionPrompt(request({ nodeId: "gate", kind: "rules" }));
		expect(text).toContain("review.outcome = 'pass'");
		expect(text).toContain("without the braces");
	});

	test("command: the project's package manager and scripts, and the exits", () => {
		const text = suggestionPrompt(
			request({ nodeId: "check", kind: "command" }),
			{
				packageManager: "bun",
				scripts: { test: "bun test" },
				taskFiles: ["Makefile"],
			},
		);
		expect(text).toContain("Package manager: bun");
		expect(text).toContain("- `test`: `bun test`");
		expect(text).toContain("0 → `pass`");
		expect(text).toContain("`Makefile`");
	});

	test("command of a list: the item shape, the called flow, and a tracker example", () => {
		const text = suggestionPrompt(
			request({ nodeId: "traces", kind: "command" }),
			{ packageManager: null, scripts: {}, taskFiles: [] },
		);
		expect(text).toContain("Print one JSON array on stdout");
		expect(text).toContain("`dependsOn`");
		expect(text).toContain("`.nightshift/flows/trace.json`");
		expect(text).toContain("`{{task.<field>}}`");
		expect(text).toContain("subIssues(first: 100)");
		expect(text).toContain("cat tasks.json");
		expect(text).not.toContain("The node's exits");
	});

	test("checker: the outcomes to pick from and the agent's prompt", () => {
		const text = suggestionPrompt(
			request({ nodeId: "review", kind: "checker" }),
		);
		expect(text).toContain("Write the brief of the checker");
		expect(text).toContain('"name": "needs-input"');
	});

	test("arguments: the tool's input schema from the editor", () => {
		const text = suggestionPrompt(
			request({
				nodeId: "issue",
				kind: "arguments",
				toolSchema: {
					type: "object",
					properties: { title: { type: "string" } },
				},
			}),
		);
		expect(text).toContain("`create_issue` of the MCP server `linear`");
		expect(text).toContain('"title"');
	});

	test("description and inputs read the flow, with no node", () => {
		const description = suggestionPrompt(request({ kind: "description" }));
		expect(description).toContain("Suggest a description for the flow.");
		expect(description).not.toContain("# The node");
		const inputs = suggestionPrompt(request({ kind: "inputs" }));
		expect(inputs).toContain("- `owner`: read by `notify`");
		expect(inputs).toContain("- `pr`: review");
	});
});

describe("the checks of the newer kinds", () => {
	test("each kind's data schema is its own", () => {
		const keys = (kind: SuggestionRequest["kind"]) =>
			Object.keys(
				(suggestionDataSchema(kind) as { properties: object }).properties,
			);
		expect(keys("outcomes")).toEqual(["outcomes"]);
		expect(keys("arguments")).toEqual(["arguments"]);
		expect(keys("inputs")).toEqual(["inputs"]);
	});

	test("a kind fits only a node with its field", () => {
		expect(
			cannotSuggest(request({ nodeId: "check", kind: "rules" })),
		).toContain("A Command node has no rules");
		expect(cannotSuggest(request({ kind: "inputs" }))).toBeNull();
		expect(
			cannotSuggest(request({ nodeId: "review", kind: "checker" })),
		).toBeNull();
	});

	test("outcomes: `from` must name an outcome the node has", () => {
		const bad = checkSuggestion(
			request({ nodeId: "review", kind: "outcomes" }),
			{
				summary: "x",
				data: { outcomes: [{ name: "approved", from: "ok" }] },
			},
		);
		expect("problems" in bad && bad.problems[0]).toContain('`from` is "ok"');
		const good = checkSuggestion(
			request({ nodeId: "review", kind: "outcomes" }),
			{
				summary: "x",
				data: {
					outcomes: [
						{ name: "approved", description: "Merge it.", from: "pass" },
						{ name: "fail", description: "It cannot merge." },
					],
				},
			},
		);
		expect("suggestion" in good).toBe(true);
	});

	test("rules: an option the node does not have, or a rule that does not parse, fails", () => {
		const unknown = checkSuggestion(
			request({ nodeId: "gate", kind: "rules" }),
			{
				summary: "x",
				data: { rules: [{ option: "merge", when: "true" }] },
			},
		);
		expect("problems" in unknown && unknown.problems[0]).toContain("merge");
		const broken = checkSuggestion(request({ nodeId: "gate", kind: "rules" }), {
			summary: "x",
			data: { rules: [{ option: "ship", when: "check.exit_code = = 0" }] },
		});
		expect("problems" in broken).toBe(true);
	});

	test("arguments: a required argument left out, or one the tool does not take, fails", () => {
		const result = checkSuggestion(
			request({
				nodeId: "issue",
				kind: "arguments",
				toolSchema: {
					type: "object",
					properties: { title: { type: "string" }, team: { type: "string" } },
					required: ["title"],
				},
			}),
			{ summary: "x", data: { arguments: { teem: "web" } } },
		);
		expect("problems" in result && result.problems).toEqual([
			"The argument `title` is required. Give it a value.",
			"The tool takes no argument `teem`. Use one of `title`, `team`.",
		]);
	});

	test("inputs: dropping an input a template reads fails", () => {
		const result = checkSuggestion(request({ kind: "inputs" }), {
			summary: "x",
			data: { inputs: [{ name: "owner", type: "text" }] },
		});
		expect("problems" in result && result.problems.join(" ")).toContain("pr");
	});
});

describe("readProjectFacts", () => {
	test("reads the lock file, the scripts and the task files", async () => {
		const dir = await mkdtemp(join(tmpdir(), "ns-facts-"));
		try {
			await writeFile(join(dir, "pnpm-lock.yaml"), "");
			await writeFile(join(dir, "Makefile"), "");
			await writeFile(
				join(dir, "package.json"),
				JSON.stringify({ scripts: { lint: "biome check", bad: 1 } }),
			);
			expect(await readProjectFacts(dir)).toEqual({
				packageManager: "pnpm",
				scripts: { lint: "biome check" },
				taskFiles: ["Makefile"],
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("a folder without a project gives nothing, without throwing", async () => {
		expect(await readProjectFacts("/nonexistent-ns-folder")).toEqual({
			packageManager: null,
			scripts: {},
			taskFiles: [],
		});
	});
});
