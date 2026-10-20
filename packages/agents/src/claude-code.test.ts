import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	claudeAllowedTools,
	claudeCodeHarness,
	claudeCommand,
	claudeMcpConfig,
	cliAllowRules,
} from "./claude-code";
import { REPORT_TOOL_ID } from "./claude-code-profile";
import { fakeBin } from "./testing/fixtures/bin";
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
	test("adds the session's MCP config", () => {
		expect(claudeCommand(undefined)).toBe("claude");
		expect(claudeCommand("claude", "/tmp/m.json").split(" ")).toEqual([
			"claude",
			"--mcp-config",
			"/tmp/m.json",
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

describe("claudeAllowedTools", () => {
	test("no CLI tools: the report's rules as they are", () => {
		expect(claudeAllowedTools(input(), ["Read"])).toEqual(["Read"]);
		expect(claudeAllowedTools(input(), undefined)).toBeUndefined();
	});

	test("CLI tools and MCP servers: allowed after the report's rules", () => {
		expect(
			claudeAllowedTools(
				input({
					clis: ["gh", "aws"],
					mcpServers: { docs: { url: "https://d", headers: {} } },
				}),
				["Read", REPORT_TOOL_ID],
			),
		).toEqual([
			"Read",
			REPORT_TOOL_ID,
			"Bash(gh:*)",
			"Bash(aws:*)",
			"mcp__docs",
		]);
	});

	test("CLI tools without other rules allow only the CLI tools", () => {
		expect(claudeAllowedTools(input({ clis: ["gh"] }), undefined)).toEqual([
			"Bash(gh:*)",
		]);
	});
});

describe("cliAllowRules", () => {
	test("one Bash rule per CLI tool", () => {
		expect(
			cliAllowRules({ clis: ["gh", "acli"], permissionMode: "default" }),
		).toEqual(["Bash(gh:*)", "Bash(acli:*)"]);
	});

	test("plan mode runs nothing, so it gets none", () => {
		expect(cliAllowRules({ clis: ["gh"], permissionMode: "plan" })).toEqual([]);
	});
});

describe("claudeCodeHarness with CLI tools", () => {
	test("the CLI tools reach --allowedTools", async () => {
		const claudeLog = join(dir, "claude.jsonl");
		const claude = await fakeBin(dir, "claude", "fake-claude", {
			FAKE_CLAUDE_LOG: claudeLog,
			FAKE_CLAUDE_CALLS: JSON.stringify([
				{
					name: "report_step",
					arguments: { outcome: "pass", summary: "Done." },
				},
			]),
		});
		const events: AgentEvent[] = [];
		for await (const event of claudeCodeHarness({
			claudeExecutable: claude,
		}).run(input({ clis: ["gh"], stepReport: true }))) {
			events.push(event);
		}
		expect(events.at(-1)?.type).toBe("finished");
		const run = JSON.parse((await readFile(claudeLog, "utf8")).trim());
		const argv: string[] = run.argv;
		const allowed = argv[argv.indexOf("--allowedTools") + 1]?.split(",");
		expect(allowed).toEqual([REPORT_TOOL_ID, "Bash(gh:*)"]);
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
