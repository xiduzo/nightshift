import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type FakeHarness, fakeHarness } from "@nightshift/agents/fake";
import type { AgentHarness } from "@nightshift/agents/types";
import type {
	AgentNode,
	CommandNode,
	Flow,
	FlowEdge,
	Policy,
} from "@nightshift/flows";

import { createEngine, type EngineInternals } from "./engine";
import type { McpExpansion } from "./mcp";
import { defaultRunSettings, type RunSettings } from "./settings";
import {
	createSandbox,
	type Sandbox,
	scriptedHarness,
	waitFor,
} from "./test-support";
import type { Engine, EngineOptions, RunDetail } from "./types";

/** The engine's hooks for the daemon's settings and connections. */

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

function makeEngine(
	harness: AgentHarness,
	options: Pick<
		EngineOptions,
		"settings" | "mcpServersFor" | "connectionNames"
	> = {},
	internals: EngineInternals = {},
): Engine {
	return createEngine(
		{
			db: sandbox.db,
			harnesses: { "claude-code": harness },
			dataDir: sandbox.dataDir,
			scheduler: false,
			...options,
		},
		internals,
	);
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
		tools: [],
		...extra,
	};
}

function command(id: string, cmd: string): CommandNode {
	return { id, type: "command", position: { x: 0, y: 0 }, command: cmd };
}

function flowOf(
	nodes: (AgentNode | CommandNode)[],
	edges: FlowEdge[] = [],
	policy?: Policy,
): Flow {
	return {
		version: 2,
		inputs: [],
		outputs: [],
		start: nodes[0]?.id ?? "",
		nodes,
		edges,
		...(policy ? { policy } : {}),
	};
}

async function projectId(engine: Engine): Promise<string> {
	return (await engine.addProject({ repoPath: sandbox.repoPath })).id;
}

async function waitForEnd(engine: Engine, runId: string): Promise<RunDetail> {
	return waitFor(
		async () => {
			const detail = await engine.getRun(runId);
			return detail.status === "running" || detail.status === "sleeping"
				? null
				: detail;
		},
		{ label: "the run to end", timeoutMs: 10_000 },
	);
}

/** Settings the test changes between starts. */
function mutableSettings(patch: Partial<RunSettings> = {}) {
	const settings: RunSettings = { ...defaultRunSettings(), ...patch };
	return { settings, read: () => settings };
}

describe("connections at the start", () => {
	test("a flow that names a connection the daemon does not have refuses to start", async () => {
		const harness = fakeHarness();
		const engine = makeEngine(harness, {
			connectionNames: () => new Set(["tracker"]),
			mcpServersFor: async () => ({ ok: true, servers: {} }),
		});
		await expect(
			engine.startRun({
				projectId: await projectId(engine),
				flow: flowOf(
					[
						agent("planner", { connections: ["tracker", "ghost"] }),
						agent("builder", { connections: ["ghost", "phantom"] }),
					],
					[{ id: "e1", from: "planner", outcome: "pass", to: "builder" }],
				),
			}),
		).rejects.toThrow(
			'The flow names the connection "ghost" (planner, builder), but this daemon does not have it. Add it under Agents → Tools. The flow names the connection "phantom" (builder), but this daemon does not have it. Add it under Agents → Tools.',
		);
		expect(await engine.listRuns()).toEqual([]);
		expect(harness.calls).toHaveLength(0);
	});

	test("without connection names, any connection is unknown", async () => {
		const engine = makeEngine(fakeHarness());
		await expect(
			engine.startRun({
				projectId: await projectId(engine),
				flow: flowOf([agent("worker", { connections: ["tracker"] })]),
			}),
		).rejects.toThrow(
			'The flow names the connection "tracker" (worker), but this daemon does not have it.',
		);
	});

	test("the names are read at each start", async () => {
		const names = new Set<string>();
		const engine = makeEngine(fakeHarness(), {
			connectionNames: () => names,
			mcpServersFor: async () => ({ ok: true, servers: {} }),
		});
		const input = {
			projectId: await projectId(engine),
			flow: flowOf([agent("worker", { connections: ["tracker"] })]),
		};
		await expect(engine.startRun(input)).rejects.toThrow('"tracker"');
		names.add("tracker");
		const run = await engine.startRun(input);
		expect((await waitForEnd(engine, run.id)).status).toBe("finished");
	});
});

describe("mcpServersFor", () => {
	test("the harness gets what mcpServersFor returns for the node", async () => {
		const harness: FakeHarness = fakeHarness();
		const asked: Pick<AgentNode, "connections" | "mcpServers">[] = [];
		const servers = {
			tracker: {
				command: "tracker-mcp",
				args: [],
				env: { TOKEN: "expanded-secret" },
			},
		};
		const engine = makeEngine(harness, {
			connectionNames: () => new Set(["tracker"]),
			async mcpServersFor(node): Promise<McpExpansion> {
				asked.push(node);
				return { ok: true, servers };
			},
		});
		const own = { local: { command: "own-mcp", args: [], env: {} } };
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf([
				agent("worker", { connections: ["tracker"], mcpServers: own }),
			]),
		});
		expect((await waitForEnd(engine, run.id)).status).toBe("finished");
		expect(asked).toHaveLength(1);
		expect(asked[0]).toMatchObject({
			connections: ["tracker"],
			mcpServers: own,
		});
		expect(harness.calls[0]?.mcpServers).toEqual(servers);
	});

	test("a refusal from mcpServersFor fails the step with its message", async () => {
		const harness = fakeHarness();
		const engine = makeEngine(harness, {
			connectionNames: () => new Set(["tracker"]),
			mcpServersFor: async () => ({
				ok: false,
				message: "The MCP server tracker reads TRACKER_TOKEN.",
			}),
		});
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf([agent("worker", { connections: ["tracker"] })]),
		});
		const detail = await waitForEnd(engine, run.id);
		expect(detail.status).toBe("failed");
		expect(detail.steps[0]).toMatchObject({
			outcome: "error",
			error: "The MCP server tracker reads TRACKER_TOKEN.",
		});
		expect(harness.calls).toHaveLength(0);
	});

	test("without mcpServersFor, a node with connections fails its step with a clear error", async () => {
		const harness = fakeHarness();
		const engine = makeEngine(harness, {
			connectionNames: () => new Set(["tracker", "docs"]),
		});
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf([agent("worker", { connections: ["tracker", "docs"] })]),
		});
		const detail = await waitForEnd(engine, run.id);
		expect(detail.status).toBe("failed");
		expect(detail.steps[0]).toMatchObject({
			outcome: "error",
			error:
				"The node names connections (tracker, docs), but this daemon has none.",
		});
		expect(harness.calls).toHaveLength(0);
	});
});

describe("settings", () => {
	test("the run cap is the settings' value at the time of each start", async () => {
		const { harness, sessions } = scriptedHarness();
		const { settings, read } = mutableSettings({ maxConcurrentRuns: 1 });
		const engine = makeEngine(harness, { settings: read });
		const input = {
			projectId: await projectId(engine),
			flow: flowOf([agent("worker")]),
		};
		const first = await engine.startRun(input);
		await waitFor(() => sessions[0]);
		await expect(engine.startRun(input)).rejects.toThrow(
			"The run cap is reached: 1 of 1",
		);

		settings.maxConcurrentRuns = 2;
		const second = await engine.startRun(input);
		await waitFor(() => sessions[1]);
		await expect(engine.startRun(input)).rejects.toThrow(
			"The run cap is reached: 2 of 2",
		);

		// Lowering the cap stops new starts but leaves running runs alone.
		settings.maxConcurrentRuns = 1;
		await expect(engine.startRun(input)).rejects.toThrow(
			"The run cap is reached: 2 of 1",
		);
		sessions[0]?.finish();
		sessions[1]?.finish();
		expect((await waitForEnd(engine, first.id)).status).toBe("finished");
		expect((await waitForEnd(engine, second.id)).status).toBe("finished");
	});

	test("the step cap comes from the settings", async () => {
		const engine = makeEngine(fakeHarness(), {
			settings: mutableSettings({ maxStepsPerRun: 3 }).read,
		});
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf(
				[agent("worker"), command("check", "exit 1")],
				[
					{ id: "e1", from: "worker", outcome: "pass", to: "check" },
					{
						id: "e2",
						from: "check",
						outcome: "fail",
						to: "worker",
						max: 10,
					},
				],
			),
		});
		const detail = await waitForEnd(engine, run.id);
		expect(detail.status).toBe("failed");
		expect(detail.steps).toHaveLength(3);
		expect(detail.reason).toContain("limit of 3 steps");
	});

	describe("the run policy", () => {
		const networkDown = () =>
			fakeHarness({
				steps: [],
				delayMs: 1,
				outcome: {
					type: "error",
					kind: "network",
					message: "connection refused",
				},
			});

		test("a flow without its own policy uses the settings' network grace", async () => {
			const harness = networkDown();
			const engine = makeEngine(
				harness,
				{
					settings: mutableSettings({
						policy: {
							usageLimitFirstWaitMinutes: 5,
							usageLimitMaxWaitMinutes: 60,
							networkGraceMinutes: 1,
						},
					}).read,
				},
				{ minuteMs: 100 },
			);
			const run = await engine.startRun({
				projectId: await projectId(engine),
				flow: flowOf([agent("worker")]),
			});
			const detail = await waitForEnd(engine, run.id);
			expect(detail.status).toBe("failed");
			// One wait of 1 min fits the grace of 1 min; the next of 2 does not.
			expect(harness.calls).toHaveLength(2);
			expect(detail.steps[0]?.error).toContain("grace of 1 min");
		});

		test("a number the flow sets itself wins over the settings", async () => {
			const harness = networkDown();
			const engine = makeEngine(
				harness,
				{
					settings: mutableSettings({
						policy: {
							usageLimitFirstWaitMinutes: 5,
							usageLimitMaxWaitMinutes: 60,
							networkGraceMinutes: 1,
						},
					}).read,
				},
				{ minuteMs: 100 },
			);
			const run = await engine.startRun({
				projectId: await projectId(engine),
				// Only the grace: the other numbers still come from the settings.
				flow: flowOf([agent("worker")], [], { networkGraceMinutes: 4 }),
			});
			const detail = await waitForEnd(engine, run.id);
			expect(detail.status).toBe("failed");
			expect(harness.calls).toHaveLength(3);
			expect(detail.steps[0]?.error).toContain("grace of 4 min");
		});
	});
});
