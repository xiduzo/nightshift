import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ACP_AGENTS,
	type AcpAgent,
	acpAgentHarness,
	acpHarness,
	acpPermission,
	customAcpHarness,
	observeAcpEvent,
} from "./acp";
import { fakeBin } from "./fixtures/bin";
import type { AgentEvent, AgentSessionInput } from "./types";

let dir: string;
let cwd: string;
let log: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "nightshift-acp-"));
	cwd = await mkdtemp(join(tmpdir(), "nightshift-acp-cwd-"));
	log = join(dir, "acp.jsonl");
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
	await rm(cwd, { recursive: true, force: true });
});

function input(overrides: Partial<AgentSessionInput> = {}): AgentSessionInput {
	return {
		cwd,
		prompt: "Run the tests",
		model: "gpt-5",
		permissionMode: "acceptEdits",
		stepReport: true,
		signal: new AbortController().signal,
		...overrides,
	};
}

async function run(overrides: Partial<AgentSessionInput> = {}) {
	const executable = await fakeBin(dir, "copilot", "fake-acp", {
		FAKE_ACP_LOG: log,
	});
	const events: AgentEvent[] = [];
	for await (const event of acpHarness("copilot", { executable }).run(
		input(overrides),
	)) {
		events.push(event);
	}
	return events;
}

async function logged(): Promise<Record<string, unknown>[]> {
	const text = await readFile(log, "utf8").catch(() => "");
	return text
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
}

const entry = (lines: Record<string, unknown>[], type: string) =>
	lines.find((line) => line.type === type);

describe("acpHarness", () => {
	test("a session streams text, reports over the bridge, and finishes", async () => {
		const events = await run();
		expect(events[0]).toEqual({ type: "session", sessionId: "fake-session-1" });
		expect(events).toContainEqual(
			expect.objectContaining({ type: "text", delta: "Running the tests." }),
		);
		expect(events).toContainEqual({
			type: "report",
			outcome: "pass",
			summary: "The tests pass.",
		});
		expect(events.at(-1)?.type).toBe("finished");

		const lines = await logged();
		expect(entry(lines, "argv")?.argv).toEqual([
			"--acp",
			"--stdio",
			"--model",
			"gpt-5",
		]);
		// The user's own login: no ACP authenticate.
		expect(entry(lines, "authenticate")).toBeUndefined();
		expect(entry(lines, "session")?.mcp).toEqual(["tanstack"]);
		expect(entry(lines, "report")).toEqual({ type: "report", isError: false });
		// The sandbox marker does not stay in the worktree.
		expect(await readdir(cwd)).toEqual([]);
	});

	test("acceptEdits refuses a shell command, bypassPermissions allows it", async () => {
		await run({ permissionMode: "acceptEdits" });
		expect(entry(await logged(), "permission")?.outcome).toBe("reject");
		await rm(log);
		await run({ permissionMode: "bypassPermissions" });
		expect(entry(await logged(), "permission")?.outcome).toBe("allow");
	});

	test("model default leaves the model to the agent, effort becomes a flag", async () => {
		await run({ model: "default", effort: "high" });
		expect(entry(await logged(), "argv")?.argv).toEqual([
			"--acp",
			"--stdio",
			"--effort",
			"high",
		]);
	});

	test("a resumed session loads the session it continues", async () => {
		const events = await run({ resumeSessionId: "fake-session-1" });
		expect(entry(await logged(), "load")).toEqual({
			type: "load",
			sessionId: "fake-session-1",
		});
		expect(events.at(-1)?.type).toBe("finished");
	});

	test("a connection that is a command ends the session with an error", async () => {
		const events = await run({
			mcpServers: { linear: { command: "npx", args: ["linear-mcp"], env: {} } },
		});
		expect(events.at(-1)).toMatchObject({
			type: "error",
			kind: "harness",
			message: expect.stringContaining("linear"),
		});
	});

	test("an error the agent sends as text fails the session", () => {
		const chunk = (text: string) => ({
			kind: "update",
			update: {
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text },
			},
		});
		// Copilot's words, from a live session.
		expect(
			observeAcpEvent(
				{},
				chunk("Error: You have exceeded your monthly quota (Request ID: X)"),
			).resultError,
		).toStartWith("Error: You have exceeded");
		expect(observeAcpEvent({}, chunk("The quota is fine."))).toEqual({});
	});

	test("permission modes map onto the adapter's ACP policy", () => {
		expect(acpPermission("bypassPermissions")).toBe("bypassPermissions");
		expect(acpPermission("auto")).toBe("bypassPermissions");
		expect(acpPermission("acceptEdits")).toBe("acceptEdits");
		expect(acpPermission("default")).toBe("default");
		expect(acpPermission("plan")).toBe("default");
	});

	test("pi starts through pi-acp, with the configured pi", () => {
		const launch = ACP_AGENTS.pi.launch?.("/opt/pi/bin/pi");
		expect(launch?.argv[0]).toBe(process.execPath);
		expect(launch?.argv[1]).toEndWith("pi-acp/dist/index.js");
		expect(launch?.env).toEqual({ PI_ACP_PI_COMMAND: "/opt/pi/bin/pi" });
		expect(ACP_AGENTS.pi.args({ model: "m" })).toEqual([]);
	});

	test("each agent starts its ACP server", () => {
		expect(ACP_AGENTS.gemini.args({ model: "m" })).toEqual([
			"--acp",
			"--model",
			"m",
		]);
		expect(ACP_AGENTS.cursor.args({})).toEqual(["acp"]);
	});
});

describe("observeAcpEvent", () => {
	const usageUpdate = (cost: unknown) => ({
		kind: "update",
		update: { sessionUpdate: "usage_update", used: 1000, size: 200000, cost },
	});

	test("a usage update in dollars is the cost so far and at the end", () => {
		const signals = observeAcpEvent(
			{},
			usageUpdate({ amount: 0.42, currency: "USD" }),
		);
		const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0.42 };
		expect(signals.liveUsage).toEqual(usage);
		expect(signals.resultUsage).toEqual(usage);
	});

	test("a usage update without a cost in dollars changes nothing", () => {
		const signals = {};
		expect(observeAcpEvent(signals, usageUpdate(null))).toBe(signals);
		expect(
			observeAcpEvent(signals, usageUpdate({ amount: 1, currency: "EUR" })),
		).toBe(signals);
	});
});

/** An agent that takes its model over ACP, as pi does (pi-acp) and OpenCode 2.x. */
const bySession: AcpAgent = {
	label: "Fake agent",
	args: () => ["--stdio"],
	model: "session",
};

async function runAgent(
	agent: AcpAgent,
	config: "options" | "none",
	overrides: Partial<AgentSessionInput> = {},
) {
	const executable = await fakeBin(dir, "fake-agent", "fake-acp", {
		FAKE_ACP_LOG: log,
		FAKE_ACP_CONFIG: config,
	});
	const events: AgentEvent[] = [];
	for await (const event of acpAgentHarness("pi", agent, {
		executable,
	}).run(input(overrides))) {
		events.push(event);
	}
	return events;
}

describe("an agent that takes its model over ACP", () => {
	test("the model and the effort are set before the first prompt", async () => {
		const events = await runAgent(bySession, "options", {
			model: "ollama/qwen3-coder:latest",
			effort: "high",
		});
		expect(events.at(-1)?.type).toBe("finished");
		const lines = await logged();
		expect(entry(lines, "argv")?.argv).toEqual(["--stdio"]);
		expect(lines.filter((l) => l.type === "config")).toEqual([
			{ type: "config", configId: "model", value: "ollama/qwen3-coder:latest" },
			{ type: "config", configId: "thinking", value: "high" },
		]);
	});

	test("model default sets nothing", async () => {
		const events = await runAgent(bySession, "options", { model: "default" });
		expect(events.at(-1)?.type).toBe("finished");
		expect(entry(await logged(), "config")).toBeUndefined();
	});

	test("an effort the agent does not offer is left out", async () => {
		await runAgent(bySession, "options", {
			model: "ollama/qwen3-coder:latest",
			effort: "max",
		});
		expect(
			(await logged()).filter((l) => l.type === "config").map((l) => l.value),
		).toEqual(["ollama/qwen3-coder:latest"]);
	});

	test("a model the agent refuses fails the session with its reason", async () => {
		const events = await runAgent(bySession, "options", {
			model: "ollama/missing",
		});
		expect(events.at(-1)).toMatchObject({
			type: "error",
			message: expect.stringContaining(
				"Fake agent did not take the model ollama/missing: model not found: ollama/missing",
			),
		});
	});

	test("an agent that offers no model says to use default", async () => {
		const events = await runAgent(bySession, "none", { model: "some/model" });
		expect(events.at(-1)).toMatchObject({
			type: "error",
			message: expect.stringContaining(
				"Fake agent does not let Night Shift choose the model.",
			),
		});
	});

	test("an agent without MCP reports in text and refuses connections", async () => {
		const noMcp: AcpAgent = { ...bySession, mcp: false };
		const events = await runAgent(noMcp, "options", { model: "default" });
		expect(events).toContainEqual({
			type: "report",
			outcome: "pass",
			summary: "The tests pass.",
		});
		expect(entry(await logged(), "session")?.mcp).toEqual([]);

		const refused = await runAgent(noMcp, "options", {
			mcpServers: { linear: { url: "https://mcp.linear.app", headers: {} } },
		});
		expect(refused.at(-1)).toMatchObject({
			type: "error",
			message:
				"Fake agent cannot use connections yet. Remove linear from the node, or run it on another harness.",
		});
	});
});

describe("customAcpHarness", () => {
	async function custom(env?: () => Promise<Record<string, string>>) {
		const command = await fakeBin(dir, "goose", "fake-acp", {
			FAKE_ACP_LOG: log,
			FAKE_ACP_CONFIG: "options",
		});
		return customAcpHarness(
			{ slug: "goose", label: "Goose", command, args: ["acp"] },
			env ? { env } : {},
		);
	}

	test("runs the command with its arguments and takes the model over ACP", async () => {
		const harness = await custom(async () => ({ GOOSE_MODE: "auto" }));
		expect(harness.name).toBe("acp:goose");
		expect(harness.label).toBe("Goose");
		expect(harness.takeOverCommand("x")).toBeNull();
		const events: AgentEvent[] = [];
		for await (const event of harness.run(
			input({ model: "ollama/qwen3-coder:latest" }),
		)) {
			events.push(event);
		}
		expect(events.at(-1)?.type).toBe("finished");
		const lines = await logged();
		expect(entry(lines, "argv")?.argv).toEqual(["acp"]);
		expect(entry(lines, "config")).toEqual({
			type: "config",
			configId: "model",
			value: "ollama/qwen3-coder:latest",
		});
	});

	test("an env that cannot be read ends the session with its reason", async () => {
		const harness = await custom(async () => {
			throw new Error("Goose needs the secret GOOSE_API_KEY.");
		});
		const events: AgentEvent[] = [];
		for await (const event of harness.run(input({ model: "default" }))) {
			events.push(event);
		}
		expect(events.at(-1)).toMatchObject({
			type: "error",
			message: "Goose needs the secret GOOSE_API_KEY.",
		});
	});
});
