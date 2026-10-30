import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent, AgentSessionInput } from "../../port/types";
import { fakeBin } from "../../testing/fixtures/bin";
import {
	codexEffort,
	codexHarness,
	codexMcpConfig,
	codexPolicy,
	codexSetup,
} from "./harness";

let dir: string;
let cwd: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "nightshift-codex-"));
	cwd = await mkdtemp(join(tmpdir(), "nightshift-codex-cwd-"));
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
	await rm(cwd, { recursive: true, force: true });
});

function input(overrides: Partial<AgentSessionInput> = {}): AgentSessionInput {
	return {
		cwd,
		prompt: "Do the thing",
		model: "gpt-5.3-codex",
		permissionMode: "auto",
		signal: new AbortController().signal,
		...overrides,
	};
}

async function collect(stream: AsyncIterable<AgentEvent>) {
	const events: AgentEvent[] = [];
	for await (const event of stream) events.push(event);
	return events;
}

type LogLine = {
	argv: string[];
	prompt: string;
	config: Record<string, string>;
};

async function readLog(path: string): Promise<LogLine[]> {
	const text = await readFile(path, "utf8");
	return text
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
}

async function fakeCodex(env: Record<string, string> = {}) {
	const log = join(dir, "codex.jsonl");
	const executable = await fakeBin(dir, "codex", "fake-codex", {
		FAKE_CODEX_LOG: log,
		...env,
	});
	return { log, harness: codexHarness({ codexExecutable: executable }) };
}

const flag = (argv: string[], name: string) => argv[argv.indexOf(name) + 1];

describe("codexPolicy", () => {
	test("never asks; the mode picks the sandbox", () => {
		expect(codexPolicy("bypassPermissions")).toEqual({
			sandboxMode: "danger-full-access",
			approvalPolicy: "never",
		});
		expect(codexPolicy("auto")).toEqual({
			sandboxMode: "workspace-write",
			approvalPolicy: "never",
			networkAccessEnabled: true,
		});
		expect(codexPolicy("acceptEdits")).toEqual({
			sandboxMode: "workspace-write",
			approvalPolicy: "never",
			networkAccessEnabled: false,
		});
		for (const mode of ["default", "plan"] as const) {
			expect(codexPolicy(mode)).toEqual({
				sandboxMode: "read-only",
				approvalPolicy: "never",
			});
		}
	});
});

describe("codexMcpConfig", () => {
	test("stdio and HTTP servers as TOML overrides", () => {
		expect(
			codexMcpConfig({
				fs: { command: "npx", args: ["-y", 'a"b'], env: { TOKEN: "x" } },
				"my docs": { url: "https://d/mcp", headers: { Authorization: "B t" } },
				bare: { command: "srv", args: [], env: {} },
			}),
		).toEqual({
			"mcp_servers.fs.command": '"npx"',
			"mcp_servers.fs.args": '["-y", "a\\"b"]',
			"mcp_servers.fs.env": '{ TOKEN = "x" }',
			'mcp_servers."my docs".url': '"https://d/mcp"',
			'mcp_servers."my docs".http_headers': '{ Authorization = "B t" }',
			"mcp_servers.bare.command": '"srv"',
			"mcp_servers.bare.args": "[]",
		});
	});
});

describe("codexSetup", () => {
	test("effort: the adapter's for known models, our own override otherwise", () => {
		expect(
			codexSetup(input({ effort: "high" })).config.model_reasoning_effort,
		).toBeUndefined();
		expect(
			codexSetup(input({ model: "o9-new", effort: "max" })).config,
		).toEqual({ model_reasoning_effort: '"xhigh"' });
		expect(codexEffort("low")).toBe("low");
	});
});

describe("codexHarness", () => {
	test("a session: report through the bridged tool, text, usage", async () => {
		const { log, harness } = await fakeCodex({
			FAKE_CODEX_CALLS: JSON.stringify([
				{
					name: "report_step",
					arguments: { outcome: "pass", summary: "Done it." },
				},
			]),
			FAKE_CODEX_TEXT: "All good.",
		});
		const events = await collect(harness.run(input({ stepReport: true })));
		expect(events).toEqual([
			{ type: "session", sessionId: "fake-thread" },
			{ type: "report", outcome: "pass", summary: "Done it." },
			{ type: "text", messageId: expect.any(String), delta: "All good." },
			{
				type: "finished",
				usage: { inputTokens: 120, outputTokens: 7, cacheReadTokens: 100 },
			},
		]);
		const [line] = await readLog(log);
		expect(line?.argv.slice(0, 2)).toEqual(["exec", "--experimental-json"]);
		expect(flag(line?.argv ?? [], "--model")).toBe("gpt-5.3-codex");
		expect(flag(line?.argv ?? [], "--sandbox")).toBe("workspace-write");
		expect(line?.config.approval_policy).toBe('"never"');
		expect(line?.config["sandbox_workspace_write.network_access"]).toBe("true");
		expect(line?.prompt).toContain("report_step");
		// The worktree stays clean.
		expect(await readdir(cwd)).toEqual([]);
	});

	test("a to-do list shows each update while Codex works", async () => {
		const first = [
			{ text: "Read the code", completed: false },
			{ text: "Fix the bug", completed: false },
		];
		const second = [
			{ text: "Read the code", completed: true },
			{ text: "Fix the bug", completed: false },
		];
		const third = [
			{ text: "Read the code", completed: true },
			{ text: "Fix the bug", completed: true },
		];
		const { harness } = await fakeCodex({
			FAKE_CODEX_TODOS: JSON.stringify([first, second, third]),
		});
		const events = await collect(harness.run(input()));
		const todo = events.filter(
			(event) => "toolCallId" in event && event.toolCallId === "item_1",
		);
		expect(todo).toEqual([
			{ type: "tool-start", toolCallId: "item_1", name: "todo_list" },
			{
				type: "tool-end",
				toolCallId: "item_1",
				name: "todo_list",
				input: { items: first },
			},
			{
				type: "tool-end",
				toolCallId: "item_1",
				name: "todo_list",
				input: { items: second },
			},
			{
				type: "tool-end",
				toolCallId: "item_1",
				name: "todo_list",
				input: { items: third },
			},
			{
				type: "tool-result",
				toolCallId: "item_1",
				content: JSON.stringify({ items: third }),
			},
		]);
		// The updates come before the answer: the list is live, not only at the end.
		const lastUpdate = events.findLastIndex((e) => e.type === "tool-end");
		const text = events.findIndex((e) => e.type === "text");
		expect(lastUpdate).toBeLessThan(text);
		expect(events.at(-1)?.type).toBe("finished");
	});

	test("plan mode: read-only, and still the report tool", async () => {
		const { log, harness } = await fakeCodex();
		await collect(
			harness.run(input({ permissionMode: "plan", stepReport: true })),
		);
		const [line] = await readLog(log);
		expect(flag(line?.argv ?? [], "--sandbox")).toBe("read-only");
		expect(line?.prompt).toContain("`report_step` tool");
	});

	test("a text report counts", async () => {
		const { harness } = await fakeCodex({
			FAKE_CODEX_TEXT:
				'Checked.\nNIGHTSHIFT-REPORT: {"outcome": "fail", "summary": "No."}',
		});
		const events = await collect(harness.run(input({ stepReport: true })));
		expect(events.filter((e) => e.type === "report")).toEqual([
			{ type: "report", outcome: "fail", summary: "No." },
		]);
	});

	test("report_step is bridged; MCP servers go in as config", async () => {
		const { log, harness } = await fakeCodex();
		await collect(
			harness.run(
				input({
					stepReport: true,
					clis: ["gh"],
					mcpServers: {
						docs: { url: "https://docs/mcp", headers: { A: "b" } },
					},
				}),
			),
		);
		const [line] = await readLog(log);
		expect(line?.config["mcp_servers.docs.url"]).toBe('"https://docs/mcp"');
		expect(line?.config["mcp_servers.docs.http_headers"]).toBe('{ A = "b" }');
		expect(line?.config["mcp_servers.tanstack.url"]).toContain("http");
	});

	test("knowledge: the line before the prompt, no writable folder", async () => {
		const { log, harness } = await fakeCodex();
		await collect(
			harness.run(
				input({
					addDirs: ["/data/knowledge/p1"],
					instructions: "Project knowledge is in /data/knowledge/p1.",
				}),
			),
		);
		const [line] = await readLog(log);
		expect(line?.prompt).toStartWith(
			"Project knowledge is in /data/knowledge/p1.\n\nDo the thing",
		);
		expect(line?.argv).not.toContain("--add-dir");
	});

	test("resume: the session event comes first, before any output", async () => {
		const { log, harness } = await fakeCodex();
		const events = await collect(
			harness.run(input({ resumeSessionId: "thread-1", prompt: "Go on" })),
		);
		expect(events[0]).toEqual({ type: "session", sessionId: "thread-1" });
		expect(events.at(-1)?.type).toBe("finished");
		const [line] = await readLog(log);
		expect(line?.argv.slice(-2)).toEqual(["resume", "thread-1"]);
		expect(line?.prompt).toBe("Go on");
	});

	test("abort ends the stream with an aborted error", async () => {
		const { harness } = await fakeCodex({ FAKE_CODEX_SLEEP_MS: "30000" });
		const controller = new AbortController();
		const events: AgentEvent[] = [];
		const started = Date.now();
		for await (const event of harness.run(
			input({ signal: controller.signal }),
		)) {
			events.push(event);
			if (event.type === "session") controller.abort();
		}
		expect(Date.now() - started).toBeLessThan(5_000);
		expect(events.at(-1)).toMatchObject({ type: "error", kind: "aborted" });
	}, 10_000);

	test.each([
		[
			"You've hit your usage limit. Upgrade to Pro or try again later.",
			"usage-limit",
		],
		["exceeded retry limit, last status: 429 Too Many Requests", "usage-limit"],
		[
			"stream disconnected before completion: error sending request for url (https://chatgpt.com/backend-api/codex/responses)",
			"network",
		],
		["Model not supported", "harness"],
	])("turn.failed %j is %s", async (message, kind) => {
		const { harness } = await fakeCodex({ FAKE_CODEX_FAIL: message });
		const events = await collect(harness.run(input()));
		expect(events[0]?.type).toBe("session");
		expect(events.at(-1)).toMatchObject({ type: "error", kind, message });
	});

	test("a missing executable is a harness error", async () => {
		const harness = codexHarness({ codexExecutable: join(dir, "no-codex") });
		const events = await collect(harness.run(input()));
		expect(events.at(-1)).toMatchObject({ type: "error", kind: "harness" });
	});
});
