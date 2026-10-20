import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { HarnessName } from "@nightshift/agents";
import { harnessFacts } from "@nightshift/agents";
import { type FakeHarness, fakeHarness } from "@nightshift/agents/testing";
import { event } from "@nightshift/db/schema";
import type { AgentNode, Flow, FlowEdge } from "@nightshift/flows";

import { createEngine } from "./engine";
import { expandMcpServers } from "./mcp";
import {
	createSandbox,
	type Sandbox,
	type TestEngineOptions,
	waitFor,
	withDevice,
} from "./test-support";
import type { RunStatus, SpaceEngine } from "./types";

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

/** `${NAME}`: a reference to an environment variable. */
const ref = (name: string) => `\${${name}}`;

/** A fake harness that answers to `name`. */
function named(name: HarnessName): FakeHarness {
	return { ...fakeHarness(), name, ...harnessFacts(name) };
}

function makeEngine(harnesses: TestEngineOptions["harnesses"]): SpaceEngine {
	return createEngine(
		withDevice({
			db: sandbox.db,
			harnesses,
			dataDir: sandbox.dataDir,
			scheduler: false,
		}),
	).space(sandbox.spaceId);
}

function agent(id: string, extra: Partial<AgentNode> = {}): AgentNode {
	return {
		id,
		type: "agent",
		position: { x: 0, y: 0 },
		prompt: `Work as ${id}.`,
		harness: "claude-code",
		model: "sonnet",
		permissionMode: "acceptEdits",
		session: "fresh",
		...extra,
	};
}

function flowOf(nodes: AgentNode[], edges: FlowEdge[] = []): Flow {
	return {
		version: 5,
		inputs: [],
		outputs: [],
		start: nodes[0]?.id ?? "",
		nodes,
		edges,
	};
}

async function projectId(engine: SpaceEngine): Promise<string> {
	return (await engine.addProject({ repoPath: sandbox.repoPath })).id;
}

async function waitForEnd(
	engine: SpaceEngine,
	runId: string,
): Promise<RunStatus> {
	return waitFor(
		async () => {
			const { status } = await engine.getRun(runId);
			return status === "running" ? null : status;
		},
		{ label: "the run to end" },
	);
}

/** Every file under `dir`, as one string. */
async function readTree(dir: string): Promise<string> {
	const entries = await readdir(dir, { recursive: true, withFileTypes: true });
	const files = entries.filter((e) => e.isFile());
	const texts = await Promise.all(
		files.map((e) => readFile(join(e.parentPath, e.name), "utf8")),
	);
	return texts.join("\n");
}

describe("harnesses", () => {
	test("each Agent step runs on the harness its node names", async () => {
		const claude = named("claude-code");
		const opencode = named("opencode");
		const codex = named("codex");
		const engine = makeEngine({ "claude-code": claude, opencode, codex });
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf(
				[
					agent("planner"),
					agent("builder", {
						harness: "opencode",
						model: "anthropic/claude-sonnet-4-5",
					}),
					agent("reviewer", { harness: "codex", model: "gpt-5-codex" }),
				],
				[
					{ id: "e1", from: "planner", outcome: "pass", to: "builder" },
					{ id: "e2", from: "builder", outcome: "pass", to: "reviewer" },
				],
			),
		});
		expect(await waitForEnd(engine, run.id)).toBe("finished");
		expect(claude.calls.map((c) => c.prompt)).toEqual(["Work as planner."]);
		expect(opencode.calls.map((c) => [c.prompt, c.model])).toEqual([
			["Work as builder.", "anthropic/claude-sonnet-4-5"],
		]);
		expect(codex.calls.map((c) => [c.prompt, c.model])).toEqual([
			["Work as reviewer.", "gpt-5-codex"],
		]);
		// No MCP servers on the node: the harness gets none.
		expect(codex.calls[0]?.mcpServers).toBeUndefined();
	});

	test.each([
		["claude-code", "claude --resume fake-session-1"],
		["opencode", "opencode --session fake-session-1"],
		["codex", "codex resume fake-session-1"],
	] as const)(
		"the take-over command of a %s session",
		async (harness, command) => {
			const engine = makeEngine({ [harness]: named(harness) });
			const run = await engine.startRun({
				projectId: await projectId(engine),
				flow: flowOf([agent("worker", { harness })]),
			});
			expect(await waitForEnd(engine, run.id)).toBe("finished");
			expect((await engine.getRun(run.id)).takeOverCommand).toBe(
				`cd ${run.worktreePath} && ${command}`,
			);
		},
	);

	test("the take-over command follows the last session's harness", async () => {
		const engine = makeEngine({
			"claude-code": named("claude-code"),
			codex: named("codex"),
		});
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf(
				[agent("planner", { harness: "codex" }), agent("builder")],
				[{ id: "e1", from: "planner", outcome: "pass", to: "builder" }],
			),
		});
		expect(await waitForEnd(engine, run.id)).toBe("finished");
		// Each fake numbers its own sessions: the builder's is Claude Code's first.
		expect((await engine.getRun(run.id)).takeOverCommand).toBe(
			`cd ${run.worktreePath} && claude --resume fake-session-1`,
		);
	});

	test("startRun refuses a flow whose agents name a harness that is not configured", async () => {
		const claude = named("claude-code");
		const engine = makeEngine({ "claude-code": claude });
		await expect(
			engine.startRun({
				projectId: await projectId(engine),
				flow: flowOf(
					[
						agent("planner"),
						agent("builder", { harness: "opencode" }),
						agent("fixer", { harness: "opencode" }),
						agent("reviewer", { harness: "codex" }),
					],
					[
						{ id: "e1", from: "planner", outcome: "pass", to: "builder" },
						{ id: "e2", from: "builder", outcome: "pass", to: "fixer" },
						{ id: "e3", from: "fixer", outcome: "pass", to: "reviewer" },
					],
				),
			}),
		).rejects.toThrow(
			"The flow has Agent nodes on OpenCode (builder, fixer), but no OpenCode harness is added. Add it under Agents. The flow has an Agent node on Codex (reviewer), but no Codex harness is added. Add it under Agents.",
		);
		expect(await engine.listRuns()).toEqual([]);
		expect(claude.calls).toHaveLength(0);
	});
});

describe("custom agents", () => {
	test("an Agent node on a custom agent runs on it, with its label", async () => {
		const goose: FakeHarness = {
			...fakeHarness(),
			name: "acp:goose",
			label: "Goose",
		};
		const engine = createEngine(
			withDevice({
				db: sandbox.db,
				harnesses: { "claude-code": named("claude-code") },
				customHarness: (name) => (name === "acp:goose" ? goose : undefined),
				customHarnessNames: () => ["acp:goose"],
				dataDir: sandbox.dataDir,
				scheduler: false,
			}),
		).space(sandbox.spaceId);
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf([
				agent("worker", { harness: "acp:goose", model: "default" }),
			]),
		});
		expect(await waitForEnd(engine, run.id)).toBe("finished");
		expect(goose.calls.map((c) => [c.prompt, c.model])).toEqual([
			["Work as worker.", "default"],
		]);
		// A custom agent has no take-over command.
		expect((await engine.getRun(run.id)).takeOverCommand).toBeNull();
	});

	test("a flow on a custom agent this computer has not added does not start", async () => {
		const engine = makeEngine({ "claude-code": named("claude-code") });
		await expect(
			engine.startRun({
				projectId: await projectId(engine),
				flow: flowOf([agent("worker", { harness: "acp:goose" })]),
			}),
		).rejects.toThrow(
			"The flow has an Agent node on goose (worker), but no custom agent goose is added. Add it under Agents.",
		);
	});
});

describe("MCP servers", () => {
	const TOKEN = "NIGHTSHIFT_TEST_MCP_TOKEN";
	const SECRET = "s3cret-value-for-the-test";
	beforeEach(() => {
		process.env[TOKEN] = SECRET;
	});
	afterEach(() => {
		delete process.env[TOKEN];
	});

	test("the harness gets the node's MCP servers with the references expanded", async () => {
		const harness = named("opencode");
		const engine = makeEngine({ opencode: harness });
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf([
				agent("worker", {
					harness: "opencode",
					mcpServers: {
						local: {
							command: "my-mcp",
							args: ["--token", ref(TOKEN)],
							env: { API_TOKEN: ref(TOKEN), MODE: "night" },
						},
						remote: {
							url: "https://mcp.example.com/mcp",
							headers: { Authorization: `Bearer ${ref(TOKEN)}` },
						},
					},
				}),
			]),
		});
		expect(await waitForEnd(engine, run.id)).toBe("finished");
		expect(harness.calls[0]?.mcpServers).toEqual({
			local: {
				command: "my-mcp",
				// Arguments stay as written: only env values and headers expand.
				args: ["--token", ref(TOKEN)],
				env: { API_TOKEN: SECRET, MODE: "night" },
			},
			remote: {
				url: "https://mcp.example.com/mcp",
				headers: { Authorization: `Bearer ${SECRET}` },
			},
		});

		// The run's snapshot keeps the reference; the value is never logged.
		const detail = await engine.getRun(run.id);
		const node = detail.flow.nodes[0] as AgentNode;
		expect(node.mcpServers?.local).toMatchObject({
			env: { API_TOKEN: ref(TOKEN) },
		});
		const rows = await sandbox.db.select().from(event);
		expect(JSON.stringify(rows)).not.toContain(SECRET);
		expect(await readTree(sandbox.dataDir)).not.toContain(SECRET);
	});

	test("a variable the daemon does not have refuses the step and names it", async () => {
		const harness = named("claude-code");
		const engine = makeEngine({ "claude-code": harness });
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf([
				agent("worker", {
					mcpServers: {
						tracker: {
							url: "https://mcp.example.com/mcp",
							headers: {
								Authorization: `Bearer ${ref("NIGHTSHIFT_TEST_NOT_SET")}`,
								"X-Other": ref(TOKEN),
							},
						},
					},
				}),
			]),
		});
		expect(await waitForEnd(engine, run.id)).toBe("failed");
		expect(harness.calls).toHaveLength(0);
		const step = (await engine.getRun(run.id)).steps[0];
		expect(step?.outcome).toBe("error");
		expect(step?.error).toBe(
			'The MCP server "tracker" needs the secret NIGHTSHIFT_TEST_NOT_SET, but it is not saved. Save it under Agents → Secrets, or remove the reference.',
		);
		expect(step?.error).not.toContain(SECRET);
		expect(step?.sessions).toEqual([]);
	});
});

describe("expandMcpServers", () => {
	test("expands every reference in a value and leaves other text alone", () => {
		expect(
			expandMcpServers(
				{
					a: {
						command: "x",
						args: [],
						env: {
							PAIR: `${ref("USER_A")}:${ref("USER_B")}`,
							PLAIN: "$HOME and {NAME}",
						},
					},
				},
				{ USER_A: "a", USER_B: "b" },
			),
		).toEqual({
			ok: true,
			servers: {
				a: {
					command: "x",
					args: [],
					env: { PAIR: "a:b", PLAIN: "$HOME and {NAME}" },
				},
			},
		});
	});

	test("an empty value counts as set", () => {
		expect(
			expandMcpServers(
				{ a: { url: "https://x.test/", headers: { H: ref("EMPTY") } } },
				{ EMPTY: "" },
			),
		).toEqual({
			ok: true,
			servers: { a: { url: "https://x.test/", headers: { H: "" } } },
		});
	});

	test("names every missing variable of the first server that misses one", () => {
		const result = expandMcpServers(
			{
				a: {
					command: "x",
					args: [],
					env: {
						ONE: ref("MISSING_ONE"),
						TWO: `${ref("MISSING_TWO")}${ref("MISSING_ONE")}`,
					},
				},
			},
			{},
		);
		expect(result).toEqual({
			ok: false,
			message:
				'The MCP server "a" needs the secrets MISSING_ONE, MISSING_TWO, but they are not saved. Save them under Agents → Secrets, or remove the reference.',
		});
	});

	test("no servers is an empty set", () => {
		expect(expandMcpServers(undefined, {})).toEqual({ ok: true, servers: {} });
	});
});
