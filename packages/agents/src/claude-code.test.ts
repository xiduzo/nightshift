import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCodeHarness, claudeCommand, harnessSetup } from "./claude-code";
import { fakeBin } from "./fixtures/bin";
import { GITHUB_TOOL_IDS, GITHUB_TOOL_NAMES } from "./github";
import { REPORT_TOOL_ID } from "./step-report";
import type { AgentEvent, AgentSessionInput } from "./types";

let dir: string;
let cwd: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "nightshift-harness-"));
	cwd = await mkdtemp(join(tmpdir(), "nightshift-harness-cwd-"));
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
	await rm(cwd, { recursive: true, force: true });
});

function input(overrides: Partial<AgentSessionInput> = {}): AgentSessionInput {
	return {
		cwd,
		prompt: "Do the thing",
		model: "haiku",
		permissionMode: "default",
		signal: new AbortController().signal,
		...overrides,
	};
}

describe("claudeCommand", () => {
	test("adds the flags that leave only the bridged tools", () => {
		expect(claudeCommand(undefined, false)).toBe("claude");
		expect(claudeCommand("/bin/claude", true).split(" ")).toEqual([
			"/bin/claude",
			"--strict-mcp-config",
			"--tools",
			"",
		]);
	});
});

describe("harnessSetup", () => {
	test("no tool sets: no bridged tools", () => {
		const setup = harnessSetup(input(), { allowedTools: ["Read"] });
		expect(setup.tools).toEqual([]);
		expect(setup.allowedTools).toEqual(["Read"]);
		expect(setup.bridgedToolsOnly).toBeUndefined();
	});

	test("github: the tools, allowed, next to report_step", () => {
		const setup = harnessSetup(input({ tools: ["github"], stepReport: true }), {
			allowedTools: ["Read"],
		});
		expect(setup.tools.map((t) => t.name)).toEqual([
			"report_step",
			...GITHUB_TOOL_NAMES,
		]);
		expect(setup.allowedTools).toEqual([
			"Read",
			REPORT_TOOL_ID,
			...GITHUB_TOOL_IDS,
		]);
		// Agent sessions keep their built-in tools.
		expect(setup.bridgedToolsOnly).toBeUndefined();
	});

	test("github without allowedTools allows only the GitHub tools", () => {
		expect(harnessSetup(input({ tools: ["github"] }), {}).allowedTools).toEqual(
			[...GITHUB_TOOL_IDS],
		);
	});
});

describe("claudeCodeHarness with github", () => {
	test("GitHub tool calls are normal tool events; report_step still reports", async () => {
		const rules = join(dir, "rules.json");
		await writeFile(
			rules,
			JSON.stringify([
				{
					tool: "gh",
					args: ["issue", "list"],
					stdout: JSON.stringify([{ number: 1, title: "A", labels: [] }]),
				},
			]),
		);
		const claudeLog = join(dir, "claude.jsonl");
		const gh = await fakeBin(dir, "gh", "fake-gh", {
			FAKE_TOOL: "gh",
			FAKE_RULES: rules,
		});
		const claude = await fakeBin(dir, "claude", "fake-claude", {
			FAKE_CLAUDE_LOG: claudeLog,
			FAKE_CLAUDE_CALLS: JSON.stringify([
				{ name: "github_list_issues", arguments: {} },
				{
					name: "report_step",
					arguments: { outcome: "pass", summary: "Listed." },
				},
			]),
		});
		const harness = claudeCodeHarness({
			claudeExecutable: claude,
			github: { gh },
		});
		const events: AgentEvent[] = [];
		for await (const event of harness.run(
			input({ tools: ["github"], stepReport: true }),
		)) {
			events.push(event);
		}

		const types = events.map((e) => e.type);
		expect(types[0]).toBe("session");
		expect(types.at(-1)).toBe("finished");
		const start = events.find((e) => e.type === "tool-start");
		expect(start).toMatchObject({ name: "github_list_issues" });
		const result = events.find((e) => e.type === "tool-result");
		expect(
			JSON.parse(result?.type === "tool-result" ? result.content : "null"),
		).toEqual([{ number: 1, title: "A", labels: [] }]);
		expect(events.filter((e) => e.type === "report")).toEqual([
			{ type: "report", outcome: "pass", summary: "Listed." },
		]);
		// report_step is plumbing: no tool events for it.
		expect(
			events.filter(
				(e) =>
					(e.type === "tool-start" || e.type === "tool-end") &&
					e.name.includes("report"),
			),
		).toEqual([]);

		const run = JSON.parse((await readFile(claudeLog, "utf8")).trim());
		const argv: string[] = run.argv;
		expect(argv).not.toContain("--tools");
		expect(argv).not.toContain("--strict-mcp-config");
		const allowed = argv[argv.indexOf("--allowedTools") + 1]?.split(",");
		expect(allowed).toEqual([REPORT_TOOL_ID, ...GITHUB_TOOL_IDS]);
	});
});
