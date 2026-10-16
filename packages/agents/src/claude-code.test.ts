import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	claudeCodeHarness,
	claudeCommand,
	claudeMcpConfig,
	harnessSetup,
} from "./claude-code";
import { fakeBin } from "./fixtures/bin";
import { GITHUB_TOOL_IDS, GITHUB_TOOL_NAMES } from "./github";
import { REPORT_TOOL_ID } from "./step-report";
import type { AgentEvent, AgentSessionInput, StepReportSpec } from "./types";

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

	test("adds the session's MCP config before the bridge flags", () => {
		expect(claudeCommand("claude", true, "/tmp/m.json").split(" ")).toEqual([
			"claude",
			"--mcp-config",
			"/tmp/m.json",
			"--strict-mcp-config",
			"--tools",
			"",
		]);
	});
});

describe("claudeMcpConfig", () => {
	test("stdio and HTTP servers", () => {
		expect(
			JSON.parse(
				claudeMcpConfig({
					fs: { command: "npx", args: ["fs"], env: { A: "1" } },
					docs: { url: "https://d", headers: { B: "2" } },
				}),
			),
		).toEqual({
			mcpServers: {
				fs: { type: "stdio", command: "npx", args: ["fs"], env: { A: "1" } },
				docs: { type: "http", url: "https://d", headers: { B: "2" } },
			},
		});
	});
});

describe("claudeCodeHarness with MCP servers", () => {
	test("the servers load next to the bridge, allowed, from a temp file", async () => {
		const claudeLog = join(dir, "claude.jsonl");
		const claude = await fakeBin(dir, "claude", "fake-claude", {
			FAKE_CLAUDE_LOG: claudeLog,
			FAKE_CLAUDE_CALLS: JSON.stringify([
				{ name: "report_step", arguments: { outcome: "pass", summary: "Ok." } },
			]),
		});
		const events: AgentEvent[] = [];
		for await (const event of claudeCodeHarness({
			claudeExecutable: claude,
		}).run(
			input({
				stepReport: true,
				mcpServers: { docs: { url: "https://docs/mcp", headers: {} } },
			}),
		)) {
			events.push(event);
		}
		expect(events.filter((e) => e.type === "report")).toHaveLength(1);
		expect(events.at(-1)?.type).toBe("finished");

		const run = JSON.parse((await readFile(claudeLog, "utf8")).trim());
		const servers = run.mcpConfigs.map(
			(c: { mcpServers: Record<string, unknown> }) => Object.keys(c.mcpServers),
		);
		expect(servers).toEqual([["docs"], ["tanstack"]]);
		const argv: string[] = run.argv;
		const allowed = argv[argv.indexOf("--allowedTools") + 1]?.split(",");
		expect(allowed).toEqual([REPORT_TOOL_ID, "mcp__docs"]);
		// The config file lived outside the worktree and is gone.
		const path = argv[argv.indexOf("--mcp-config") + 1] ?? "";
		expect(path.startsWith(cwd)).toBe(false);
		expect(
			await access(path).then(
				() => true,
				() => false,
			),
		).toBe(false);
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

describe("claudeCodeHarness with a step report spec", () => {
	const spec: StepReportSpec = {
		outcomes: [
			{ name: "approved", description: "the change can merge" },
			{ name: "changes-requested" },
		],
		output: {
			type: "object",
			properties: { issues: { type: "array", items: { type: "string" } } },
			required: ["issues"],
		},
	};

	async function run(
		overrides: Partial<AgentSessionInput>,
		env: Record<string, string>,
	) {
		const claudeLog = join(dir, "claude.jsonl");
		const claude = await fakeBin(dir, "claude", "fake-claude", {
			FAKE_CLAUDE_LOG: claudeLog,
			...env,
		});
		const events: AgentEvent[] = [];
		for await (const event of claudeCodeHarness({
			claudeExecutable: claude,
		}).run(input({ stepReport: spec, ...overrides }))) {
			events.push(event);
		}
		const log = JSON.parse((await readFile(claudeLog, "utf8")).trim());
		return { events, log };
	}

	test("the bridged tool carries the outcomes and the data schema; the report its data", async () => {
		const { events, log } = await run(
			{},
			{
				FAKE_CLAUDE_CALLS: JSON.stringify([
					// Rejected by the tool: not one of the spec's outcomes.
					{
						name: "report_step",
						arguments: { outcome: "pass", summary: "x", data: { issues: [] } },
					},
					{
						name: "report_step",
						arguments: {
							outcome: "changes-requested",
							summary: "One issue.",
							data: { issues: ["Typo in line 2."] },
						},
					},
				]),
			},
		);
		const tool = (
			log.tools as { name: string; inputSchema: Record<string, unknown> }[]
		).find((t) => t.name === "report_step");
		expect(tool?.inputSchema).toMatchObject({
			properties: {
				outcome: { enum: ["approved", "changes-requested"] },
				data: spec.output,
			},
			required: ["outcome", "summary", "data"],
		});
		expect(log.prompt).toContain('"approved" (the change can merge)');

		const rejected = events.find((e) => e.type === "tool-result");
		expect(rejected?.type === "tool-result" && rejected.content).toContain(
			"Invalid report",
		);
		expect(events.filter((e) => e.type === "report")).toEqual([
			{
				type: "report",
				outcome: "changes-requested",
				summary: "One issue.",
				data: { issues: ["Typo in line 2."] },
			},
		]);
		expect(events.at(-1)?.type).toBe("finished");
	});

	test("plan mode: a text report with a custom outcome and data", async () => {
		const { events, log } = await run(
			{ permissionMode: "plan" },
			{
				FAKE_CLAUDE_RESULT:
					'Looks good.\nNIGHTSHIFT-REPORT: {"outcome": "approved", "summary": "Fine.", "data": {"issues": []}}',
			},
		);
		expect(log.tools).toBeUndefined();
		expect(log.prompt).toContain(JSON.stringify(spec.output));
		expect(events.filter((e) => e.type === "report")).toEqual([
			{
				type: "report",
				outcome: "approved",
				summary: "Fine.",
				data: { issues: [] },
			},
		]);
	});
});
