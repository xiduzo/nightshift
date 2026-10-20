import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent, AgentSessionInput } from "../../port/types";
import { fakeBin } from "../../testing/fixtures/bin";
import { grokBuildHarness, grokPolicy } from "./harness";

let dir: string;
let cwd: string;
let log: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "nightshift-grok-"));
	cwd = await mkdtemp(join(tmpdir(), "nightshift-grok-cwd-"));
	log = join(dir, "grok.jsonl");
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
	await rm(cwd, { recursive: true, force: true });
});

async function run(
	overrides: Partial<AgentSessionInput> = {},
	env: Record<string, string> = {},
) {
	const grokExecutable = await fakeBin(dir, "grok", "fake-grok", {
		FAKE_GROK_LOG: log,
		...env,
	});
	const events: AgentEvent[] = [];
	for await (const event of grokBuildHarness({ grokExecutable }).run({
		cwd,
		prompt: "Run the tests",
		model: "grok-build",
		permissionMode: "auto",
		stepReport: true,
		signal: new AbortController().signal,
		...overrides,
	})) {
		events.push(event);
	}
	return events;
}

async function argv(): Promise<string[]> {
	const [line] = (await readFile(log, "utf8")).trim().split("\n");
	return JSON.parse(line ?? "{}").argv;
}

describe("grokBuildHarness", () => {
	test("a session reports through its final text and finishes", async () => {
		const events = await run();
		expect(events[0]).toEqual({ type: "session", sessionId: "grok-session-1" });
		expect(events).toContainEqual({
			type: "report",
			outcome: "pass",
			summary: "The tests pass.",
		});
		expect(events.at(-1)?.type).toBe("finished");
		const args = await argv();
		expect(args).toContain("--always-approve");
		// The agent is asked for the report line.
		expect(args[args.indexOf("-p") + 1]).toContain("NIGHTSHIFT-REPORT");
		expect(await readdir(cwd)).toEqual([]);
	});

	test("plan mode runs read-only, without approving everything", async () => {
		await run({ permissionMode: "plan" });
		const args = await argv();
		expect(args).not.toContain("--always-approve");
		expect(args).toEqual(
			expect.arrayContaining([
				"--permission-mode",
				"default",
				"--sandbox",
				"read-only",
			]),
		);
	});

	test("a resumed session passes its id", async () => {
		await run({ resumeSessionId: "grok-session-1" });
		const args = await argv();
		expect(args[args.indexOf("--resume") + 1]).toBe("grok-session-1");
	});

	test("an error event about a limit makes the engine wait", async () => {
		const events = await run(
			{},
			{ FAKE_GROK_ERROR: "Rate limit reached for grok-build" },
		);
		expect(events.at(-1)).toMatchObject({ type: "error", kind: "usage-limit" });
	});

	test("permission modes become sandbox policies", () => {
		expect(grokPolicy("auto")).toBeUndefined();
		expect(grokPolicy("bypassPermissions")).toBeUndefined();
		expect(grokPolicy("acceptEdits")?.capabilities?.fileWrite).toBe("allow");
		expect(grokPolicy("plan")?.capabilities?.fileWrite).toBe("deny");
	});
});
