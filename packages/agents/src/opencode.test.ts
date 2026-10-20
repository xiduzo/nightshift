import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeBin } from "./fixtures/bin";
import {
	createOpencodeObserver,
	opencodeHarness,
	opencodeMcpConfig,
	opencodePermission,
	opencodeSessionConfig,
	rewriteServe,
} from "./opencode";
import type { SdkSignals } from "./translate";
import type { AgentEvent, AgentSessionInput } from "./types";

let dir: string;
let cwd: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "nightshift-opencode-"));
	cwd = await mkdtemp(join(tmpdir(), "nightshift-opencode-cwd-"));
});

/** `opencode serve` processes still running with this `--port=` flag. */
function servers(port: string): string[] {
	return Bun.spawnSync(["ps", "-ax", "-o", "command"])
		.stdout.toString()
		.split("\n")
		.filter((ps) => ps.includes("serve") && ps.split(" ").includes(port));
}

/** Wait until the fake servers of a log are gone: every session stops its server. */
async function serversStop(log: string): Promise<string[]> {
	if (!(await Bun.file(log).exists())) return [];
	const ports = (await readLog(log)).flatMap(
		(line) => line.argv.find((arg) => arg.startsWith("--port=")) ?? [],
	);
	const left = () => ports.flatMap(servers);
	const deadline = Date.now() + 5_000;
	while (left().length > 0 && Date.now() < deadline) await Bun.sleep(50);
	return left();
}

afterEach(async () => {
	const left = await serversStop(join(dir, "opencode.jsonl"));
	await rm(dir, { recursive: true, force: true });
	await rm(cwd, { recursive: true, force: true });
	expect(left).toEqual([]);
});

function input(overrides: Partial<AgentSessionInput> = {}): AgentSessionInput {
	return {
		cwd,
		prompt: "Do the thing",
		model: "ollama/qwen3:8b",
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
	config: Record<string, unknown> & {
		permission: Record<string, string | Record<string, string>>;
		mcp?: Record<string, unknown>;
	};
	prompt: string;
	tools?: { name: string }[];
	sessionId: string;
};

async function readLog(path: string): Promise<LogLine[]> {
	const text = await readFile(path, "utf8");
	return text
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
}

async function fakeOpencode(env: Record<string, string> = {}) {
	const log = join(dir, "opencode.jsonl");
	const executable = await fakeBin(dir, "opencode", "fake-opencode", {
		FAKE_OPENCODE_LOG: log,
		...env,
	});
	return { log, harness: opencodeHarness({ opencodeExecutable: executable }) };
}

describe("opencodePermission", () => {
	test("no mode asks: every rule is allow or deny", () => {
		for (const mode of [
			"default",
			"acceptEdits",
			"auto",
			"bypassPermissions",
			"plan",
		] as const) {
			const rules = opencodePermission(mode);
			expect(Object.keys(rules)[0]).toBe("*");
			expect(new Set(Object.values(rules))).not.toContain("ask");
			expect(rules.question).toBe("deny");
			expect(rules["tanstack_*"]).toBe("allow");
		}
	});

	test("auto: edits and commands, nothing outside the worktree", () => {
		const rules = opencodePermission("auto");
		expect(rules.edit).toBe("allow");
		expect(rules.bash).toBe("allow");
		expect(rules.external_directory).toBe("deny");
		expect(rules.doom_loop).toBe("deny");
	});

	test("acceptEdits: edits, no commands or web", () => {
		const rules = opencodePermission("acceptEdits");
		expect(rules.edit).toBe("allow");
		expect(rules.bash).toBe("deny");
		expect(rules.webfetch).toBe("deny");
	});

	test("default and plan: read-only", () => {
		for (const mode of ["default", "plan"] as const) {
			const rules = opencodePermission(mode);
			expect(rules["*"]).toBe("deny");
			expect(rules.read).toBe("allow");
			expect(rules.grep).toBe("allow");
			expect(rules.edit).toBe("deny");
			expect(rules.bash).toBe("deny");
		}
	});

	test("bypassPermissions allows all but questions", () => {
		const rules = opencodePermission("bypassPermissions");
		expect(rules.bash).toBe("allow");
		expect(rules.external_directory).toBe("allow");
	});

	test("the session's MCP servers are allowed, plan mode too", () => {
		expect(opencodePermission("plan", ["docs"])["docs_*"]).toBe("allow");
	});

	test("CLI tools are allowed where other commands are denied", () => {
		for (const mode of ["default", "acceptEdits"] as const) {
			expect(opencodePermission(mode, [], ["gh", "aws"]).bash).toEqual({
				"*": "deny",
				gh: "allow",
				"gh *": "allow",
				aws: "allow",
				"aws *": "allow",
			});
		}
	});

	test("CLI tools change nothing where every command runs, or none", () => {
		expect(opencodePermission("auto", [], ["gh"]).bash).toBe("allow");
		expect(opencodePermission("plan", [], ["gh"]).bash).toBe("deny");
	});
});

describe("opencodeMcpConfig", () => {
	test("local and remote servers", () => {
		expect(
			opencodeMcpConfig({
				fs: { command: "npx", args: ["-y", "fs"], env: { A: "1" } },
				docs: { url: "https://x/mcp", headers: { Authorization: "Bearer t" } },
			}),
		).toEqual({
			fs: {
				type: "local",
				command: ["npx", "-y", "fs"],
				environment: { A: "1" },
				enabled: true,
			},
			docs: {
				type: "remote",
				url: "https://x/mcp",
				headers: { Authorization: "Bearer t" },
				enabled: true,
			},
		});
	});
});

describe("rewriteServe", () => {
	const config = opencodeSessionConfig(
		{
			permissionMode: "auto",
			mcpServers: { docs: { url: "https://x", headers: {} } },
		},
		{ model: "x/y", permission: { edit: "ask" } },
	);

	test("runs the executable and merges the config under the adapter's", () => {
		const out = rewriteServe(
			"opencode serve --hostname=127.0.0.1 --port=5000",
			{
				OPENCODE_CONFIG_CONTENT: JSON.stringify({
					mcp: { tanstack: { type: "remote", url: "http://b" } },
				}),
			},
			{ executable: "/opt/my opencode", config, env: { HOME: "/h" } },
		);
		expect(out.command).toBe(
			"'/opt/my opencode' serve --hostname=127.0.0.1 --port=5000",
		);
		expect(out.env?.HOME).toBe("/h");
		const merged = JSON.parse(out.env?.OPENCODE_CONFIG_CONTENT ?? "{}");
		expect(Object.keys(merged.mcp)).toEqual(["docs", "tanstack"]);
		// The harness's rules win over the extra config.
		expect(merged.permission.edit).toBe("allow");
		expect(merged.model).toBe("x/y");
		expect(merged.autoupdate).toBe(false);
	});

	test("other commands pass through", () => {
		expect(
			rewriteServe("git status", undefined, { executable: "x", config }),
		).toEqual({ command: "git status", env: undefined });
	});
});

describe("createOpencodeObserver", () => {
	test("sums usage and cost over the steps of a turn", () => {
		const observe = createOpencodeObserver();
		let signals: SdkSignals = {};
		for (const [id, cost] of [
			["m1", 0.01],
			["m2", 0.02],
		] as const) {
			signals = observe(signals, {
				kind: "event",
				event: {
					type: "message.updated",
					properties: {
						info: {
							id,
							role: "assistant",
							cost,
							tokens: {
								input: 5,
								output: 2,
								reasoning: 1,
								cache: { read: 10 },
							},
						},
					},
				},
			});
		}
		const done = observe(signals, { kind: "done", message: {} });
		expect(done.done).toBe(true);
		expect(done.resultUsage?.inputTokens).toBe(30);
		expect(done.resultUsage?.outputTokens).toBe(6);
		expect(done.resultUsage?.costUsd).toBeCloseTo(0.03);
	});

	test("an API 429 is a usage limit with its retry-after", () => {
		const observe = createOpencodeObserver();
		const signals = observe(
			{},
			{
				kind: "done",
				message: {
					id: "m",
					role: "assistant",
					error: {
						name: "APIError",
						data: {
							message: "Too Many Requests",
							statusCode: 429,
							responseHeaders: { "Retry-After": "60" },
						},
					},
				},
			},
		);
		expect(signals.usageLimit?.message).toBe("Too Many Requests");
		expect(signals.usageLimit?.resetAt).toBeGreaterThan(Date.now());
	});
});

describe("opencodeHarness", () => {
	test("a session: report through the bridged tool, text, usage", async () => {
		const { log, harness } = await fakeOpencode({
			FAKE_OPENCODE_CALLS: JSON.stringify([
				{
					name: "report_step",
					arguments: { outcome: "pass", summary: "Done it." },
				},
			]),
			FAKE_OPENCODE_TEXT: "All good.",
		});
		const events = await collect(harness.run(input({ stepReport: true })));

		expect(events).toEqual([
			{ type: "session", sessionId: expect.stringMatching(/^ses_fake/) },
			{ type: "report", outcome: "pass", summary: "Done it." },
			// The adapter streams a text part whole, when it ends.
			{ type: "text", messageId: expect.any(String), delta: "All good." },
			{
				type: "finished",
				usage: { inputTokens: 110, outputTokens: 6, costUsd: 0.002 },
			},
		]);
		const [line] = await readLog(log);
		expect(line?.argv).toContain("--hostname=127.0.0.1");
		expect(line?.argv).not.toContain("--port=4096");
		expect(line?.prompt).toContain("report_step");
		expect(line?.tools?.map((t) => t.name)).toEqual(["report_step"]);
		expect(line?.config.permission.bash).toBe("allow");
		// The worktree stays clean: no marker, no opencode.json.
		expect(await readdir(cwd)).toEqual([]);
	});

	test("an invalid report shows as a tool call with its real input", async () => {
		const { harness } = await fakeOpencode({
			FAKE_OPENCODE_CALLS: JSON.stringify([
				{ name: "report_step", arguments: { outcome: "maybe" } },
			]),
		});
		const events = await collect(harness.run(input({ stepReport: true })));
		expect(events.find((e) => e.type === "tool-end")).toMatchObject({
			name: "report_step",
			input: { outcome: "maybe" },
		});
		expect(events.some((e) => e.type === "report")).toBe(false);
		expect(events.at(-1)?.type).toBe("finished");
	});

	test("plan mode still reports with the tool, read-only", async () => {
		const { log, harness } = await fakeOpencode();
		await collect(
			harness.run(input({ stepReport: true, permissionMode: "plan" })),
		);
		const [line] = await readLog(log);
		expect(line?.prompt).toContain("`report_step` tool");
		expect(line?.config.permission.edit).toBe("deny");
	});

	test("a text report counts, and the echoed prompt does not", async () => {
		const { harness } = await fakeOpencode({
			FAKE_OPENCODE_TEXT:
				'Checked.\nNIGHTSHIFT-REPORT: {"outcome": "fail", "summary": "No pelican."}',
		});
		const events = await collect(
			harness.run(
				input({
					stepReport: true,
					prompt:
						'Example: NIGHTSHIFT-REPORT: {"outcome": "pass", "summary": "x"}',
				}),
			),
		);
		const text = events.map((e) => (e.type === "text" ? e.delta : "")).join("");
		expect(text).not.toContain("Example");
		expect(events.filter((e) => e.type === "report")).toEqual([
			{ type: "report", outcome: "fail", summary: "No pelican." },
		]);
	});

	test("CLI tools and MCP servers reach the session", async () => {
		const { log, harness } = await fakeOpencode();
		await collect(
			harness.run(
				input({
					permissionMode: "acceptEdits",
					clis: ["gh"],
					mcpServers: {
						docs: { url: "https://docs/mcp", headers: { A: "b" } },
					},
				}),
			),
		);
		const [line] = await readLog(log);
		expect(line?.config.permission.bash).toEqual({
			"*": "deny",
			gh: "allow",
			"gh *": "allow",
		});
		expect(line?.config.mcp?.docs).toEqual({
			type: "remote",
			url: "https://docs/mcp",
			headers: { A: "b" },
			enabled: true,
		});
		expect(line?.config.permission["docs_*"]).toBe("allow");
	});

	test("resume continues a known session with the follow-up only", async () => {
		const { log, harness } = await fakeOpencode({
			FAKE_OPENCODE_SESSIONS: "ses_old",
		});
		const events = await collect(
			harness.run(input({ resumeSessionId: "ses_old", prompt: "Go on" })),
		);
		expect(events[0]).toEqual({ type: "session", sessionId: "ses_old" });
		const [line] = await readLog(log);
		expect(line?.sessionId).toBe("ses_old");
		expect(line?.prompt).toBe("Go on");
	});

	test("abort ends the stream; the server stops after the turn", async () => {
		const log = join(dir, "opencode.jsonl");
		const executable = await fakeBin(dir, "opencode", "fake-opencode", {
			FAKE_OPENCODE_LOG: log,
			FAKE_OPENCODE_SLEEP_MS: "30000",
		});
		const harness = opencodeHarness({
			opencodeExecutable: executable,
			abortGraceMs: 100,
		});
		const controller = new AbortController();
		const events: AgentEvent[] = [];
		const started = Date.now();
		for await (const event of harness.run(
			input({ signal: controller.signal, prompt: "Slow", stepReport: true }),
		)) {
			events.push(event);
			if (event.type === "session") {
				// Abort once the server is in the turn.
				while (!(await Bun.file(log).exists())) await Bun.sleep(20);
				controller.abort();
			}
		}
		expect(Date.now() - started).toBeLessThan(3_000);
		expect(events.at(-1)).toMatchObject({ type: "error", kind: "aborted" });
		// The abort reached the server as a session abort; the adapter's
		// teardown then stops it.
		expect(await serversStop(log)).toEqual([]);
		const [line] = await readLog(log);
		const deadline = Date.now() + 5_000;
		// The adapter's teardown ran to the end: its tool bridge is closed. The
		// shared bridge answers a closed session with 404 (an unshared one
		// refuses the connection).
		const bridge = line?.config.mcp?.tanstack as { url: string };
		const open = () =>
			fetch(bridge.url, { method: "POST" }).then(
				(response) => response.status !== 404,
				() => false,
			);
		while ((await open()) && Date.now() < deadline) await Bun.sleep(100);
		expect(await open()).toBe(false);
	}, 15_000);

	test.each([
		[
			{ name: "APIError", data: { message: "Rate limited", statusCode: 429 } },
			"usage-limit",
		],
		[
			{ name: "APIError", data: { message: "Bad gateway", statusCode: 502 } },
			"network",
		],
		[
			{
				name: "UnknownError",
				data: {
					message: "Unable to connect. Is the computer able to access the url?",
				},
			},
			"network",
		],
		[
			{
				name: "ProviderAuthError",
				data: { providerID: "x", message: "No key" },
			},
			"harness",
		],
	])("an assistant error %j is %s", async (error, kind) => {
		const { harness } = await fakeOpencode({
			FAKE_OPENCODE_ERROR: JSON.stringify(error),
		});
		const events = await collect(harness.run(input()));
		expect(events[0]?.type).toBe("session");
		expect(events.at(-1)).toMatchObject({ type: "error", kind });
	});

	test("a model without a provider is a harness error", async () => {
		const { harness } = await fakeOpencode();
		const events = await collect(harness.run(input({ model: "qwen3" })));
		expect(events.map((e) => e.type)).toEqual(["session", "error"]);
		expect(events.at(-1)).toMatchObject({
			kind: "harness",
			message: expect.stringContaining("provider/model"),
		});
	});

	test("a missing executable is a harness error", async () => {
		const harness = opencodeHarness({
			opencodeExecutable: join(dir, "no-such-opencode"),
		});
		const events = await collect(harness.run(input()));
		expect(events.at(-1)).toMatchObject({ type: "error", kind: "harness" });
	});
});
