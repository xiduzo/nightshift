import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type ClaudeCodeDeciderOptions,
	claudeCodeDecider,
	DECIDE_ACK,
	DECIDE_TOOL_ID,
	decideTool,
	decisionPrompt,
	labelsProblem,
} from "./decider";
import { fakeBin } from "./fixtures/bin";
import { GITHUB_TOOL_IDS } from "./github";
import type { DecisionInput } from "./types";

let dir: string;
let cwd: string;
let claudeLog: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "nightshift-decider-"));
	cwd = await mkdtemp(join(tmpdir(), "nightshift-decider-cwd-"));
	claudeLog = join(dir, "claude.jsonl");
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
	await rm(cwd, { recursive: true, force: true });
});

const LABELS = [
	{ name: "continue", description: "The work can go on." },
	{ name: "stop", description: "Stop the run." },
];

function input(overrides: Partial<DecisionInput> = {}): DecisionInput {
	return {
		cwd,
		prompt: "The check output says 3 tests failed. Continue or stop?",
		labels: LABELS,
		model: "haiku",
		signal: new AbortController().signal,
		...overrides,
	};
}

async function decider(
	calls: { name: string; arguments: unknown }[],
	env: Record<string, string> = {},
	options: ClaudeCodeDeciderOptions = {},
) {
	const claude = await fakeBin(dir, "claude", "fake-claude", {
		FAKE_CLAUDE_LOG: claudeLog,
		FAKE_CLAUDE_CALLS: JSON.stringify(calls),
		...env,
	});
	return claudeCodeDecider({ claudeExecutable: claude, ...options });
}

async function claudeRuns(): Promise<{ argv: string[]; prompt: string }[]> {
	try {
		return (await readFile(claudeLog, "utf8"))
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line));
	} catch {
		return [];
	}
}

function flag(argv: string[], name: string): string | undefined {
	const at = argv.indexOf(name);
	return at >= 0 ? argv[at + 1] : undefined;
}

describe("labelsProblem", () => {
	test("accepts distinct labels, refuses none, empty, and duplicates", () => {
		expect(labelsProblem(LABELS)).toBeUndefined();
		expect(labelsProblem([])).toMatch(/at least one/);
		expect(labelsProblem([{ name: " " }])).toMatch(/empty/);
		expect(labelsProblem([{ name: "a" }, { name: "a" }])).toMatch(/twice/);
	});
});

describe("decideTool", () => {
	const run = (tool: ReturnType<typeof decideTool>, args: unknown) =>
		(tool.execute as (args: unknown) => unknown)(args);

	test("records a valid label once, refuses an unknown label and a second call", () => {
		const recorded: unknown[] = [];
		const tool = decideTool(LABELS, (d) => recorded.push(d));
		expect(() => run(tool, { label: "maybe", notes: "x" })).toThrow(
			/must be one of: "continue", "stop"/,
		);
		expect(() => run(tool, { label: "stop" })).toThrow(/Invalid decision/);
		expect(recorded).toEqual([]);
		expect(run(tool, { label: "stop", notes: " Too many failures. " })).toBe(
			DECIDE_ACK,
		);
		expect(recorded).toEqual([{ label: "stop", notes: "Too many failures." }]);
		expect(() => run(tool, { label: "continue", notes: "" })).toThrow(
			/already recorded/,
		);
		expect(recorded).toHaveLength(1);
	});
});

describe("decisionPrompt", () => {
	test("holds the question, the labels with descriptions, and the rule", () => {
		const prompt = decisionPrompt({
			prompt: "Q?",
			labels: [...LABELS, { name: "retry" }],
		});
		expect(prompt).toContain("Q?");
		expect(prompt).toContain("- `continue`: The work can go on.");
		expect(prompt).toContain("- `retry`");
		expect(prompt).toContain("Call the `decide` tool exactly once");
		expect(prompt).toContain("You have no other tools.");
		expect(
			decisionPrompt({ prompt: "Q?", labels: LABELS, tools: ["github"] }),
		).toContain("`github_*` tools");
	});
});

describe("claudeCodeDecider", () => {
	test("returns the decided label, notes, and cost; built-in tools are off", async () => {
		const d = await decider([
			{ name: "decide", arguments: { label: "stop", notes: "3 tests fail." } },
		]);
		expect(d.name).toBe("claude-code");
		expect(await d.decide(input())).toEqual({
			kind: "decided",
			label: "stop",
			notes: "3 tests fail.",
			costUsd: 0.0012,
		});
		const [run] = await claudeRuns();
		const argv = run?.argv ?? [];
		// `--tools ""` and `--strict-mcp-config`: no built-in tools, no other MCP servers.
		expect(argv.slice(0, 3)).toEqual(["--strict-mcp-config", "--tools", ""]);
		expect(flag(argv, "--permission-mode")).toBe("default");
		expect(flag(argv, "--allowedTools")).toBe(DECIDE_TOOL_ID);
		expect(flag(argv, "--setting-sources")).toBe("");
		expect(flag(argv, "--max-turns")).toBe("10");
		expect(flag(argv, "--model")).toBe("haiku");
		expect(flag(argv, "--mcp-config")).toBeDefined();
		expect(run?.prompt).toContain("The check output says 3 tests failed.");
		// The worktree stays clean: no adapter temp files, no projection marker.
		expect(await readdir(cwd)).toEqual([]);
	});

	test("a wrong label is refused; a corrected call counts", async () => {
		const d = await decider([
			{ name: "decide", arguments: { label: "halt", notes: "x" } },
			{ name: "decide", arguments: { label: "continue", notes: "Fine." } },
		]);
		expect(await d.decide(input())).toMatchObject({
			kind: "decided",
			label: "continue",
			notes: "Fine.",
		});
	});

	test("only a wrong label: a harness error", async () => {
		const d = await decider([
			{ name: "decide", arguments: { label: "halt", notes: "x" } },
		]);
		expect(await d.decide(input())).toEqual({
			kind: "error",
			errorKind: "harness",
			message: "The decider ended without a valid `decide` call.",
			costUsd: 0.0012,
		});
	});

	test("no decide call: a harness error with the cost", async () => {
		const d = await decider([]);
		expect(await d.decide(input())).toMatchObject({
			kind: "error",
			errorKind: "harness",
			costUsd: 0.0012,
		});
	});

	test("a network failure maps to a network error", async () => {
		const d = await decider([], {
			FAKE_CLAUDE_RESULT_ERROR: "API Error: Connection error.",
		});
		expect(await d.decide(input())).toEqual({
			kind: "error",
			errorKind: "network",
			message: "API Error: Connection error.",
			costUsd: null,
		});
	});

	test("a usage limit maps to a usage-limit error", async () => {
		const d = await decider([], {
			FAKE_CLAUDE_RESULT_ERROR: "You've hit your limit · resets 3pm",
		});
		expect(await d.decide(input())).toMatchObject({
			kind: "error",
			errorKind: "usage-limit",
		});
	});

	test("abort stops the session and returns aborted", async () => {
		const d = await decider(
			[],
			{ FAKE_CLAUDE_SLEEP_MS: "20000" },
			{
				abortGraceMs: 500,
			},
		);
		const controller = new AbortController();
		const started = Date.now();
		setTimeout(() => controller.abort(), 500);
		const result = await d.decide(input({ signal: controller.signal }));
		expect(result).toMatchObject({ kind: "error", errorKind: "aborted" });
		expect(Date.now() - started).toBeLessThan(5_000);
	});

	test("an aborted signal and bad labels never start claude", async () => {
		const d = await decider([]);
		const controller = new AbortController();
		controller.abort();
		expect(await d.decide(input({ signal: controller.signal }))).toMatchObject({
			kind: "error",
			errorKind: "aborted",
		});
		expect(
			await d.decide(input({ labels: [{ name: "a" }, { name: "a" }] })),
		).toMatchObject({ kind: "error", errorKind: "harness" });
		expect(await claudeRuns()).toEqual([]);
	});

	test("with github: the GitHub tools next to decide", async () => {
		const ghLog = join(dir, "gh.jsonl");
		const rules = join(dir, "rules.json");
		await writeFile(
			rules,
			JSON.stringify([
				{
					tool: "gh",
					args: ["issue", "view", "3"],
					stdout: JSON.stringify({ number: 3, title: "T", labels: [] }),
				},
			]),
		);
		const gh = await fakeBin(dir, "gh", "fake-gh", {
			FAKE_TOOL: "gh",
			FAKE_LOG: ghLog,
			FAKE_RULES: rules,
		});
		const d = await decider(
			[
				{ name: "github_read_issue", arguments: { number: 3 } },
				{ name: "decide", arguments: { label: "continue", notes: "ok" } },
			],
			{},
			{ github: { gh } },
		);
		expect(await d.decide(input({ tools: ["github"] }))).toMatchObject({
			kind: "decided",
			label: "continue",
		});
		const argv = (await claudeRuns())[0]?.argv ?? [];
		expect(flag(argv, "--allowedTools")?.split(",")).toEqual([
			DECIDE_TOOL_ID,
			...GITHUB_TOOL_IDS,
		]);
		expect(argv.slice(0, 3)).toEqual(["--strict-mcp-config", "--tools", ""]);
		const ghCalls = (await readFile(ghLog, "utf8")).trim().split("\n");
		expect(JSON.parse(ghCalls[0] ?? "{}").argv.slice(0, 3)).toEqual([
			"issue",
			"view",
			"3",
		]);
	});
});
