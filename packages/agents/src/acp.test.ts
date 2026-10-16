import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ACP_AGENTS, acpHarness, acpPermission, observeAcpEvent } from "./acp";
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

	test("each agent starts its ACP server", () => {
		expect(ACP_AGENTS.gemini.args({ model: "m" })).toEqual([
			"--acp",
			"--model",
			"m",
		]);
		expect(ACP_AGENTS.cursor.args({})).toEqual(["acp"]);
	});
});
