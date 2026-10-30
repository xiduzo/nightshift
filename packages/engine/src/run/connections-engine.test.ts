import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type FakeHarness, fakeHarness } from "@nightshift/agents/testing";
import type { AgentHarness } from "@nightshift/agents/types";
import type {
	AgentNode,
	CommandNode,
	Flow,
	FlowEdge,
	Policy,
	ToolNode,
} from "@nightshift/flows";
import type { McpExpansion } from "../device-config/mcp";
import {
	defaultRunSettings,
	type RunSettings,
} from "../device-config/settings";
import type { RunDetail } from "../read/views";
import {
	createSandbox,
	type Sandbox,
	scriptedHarness,
	sleepClock,
	type TestEngineOptions,
	waitFor,
	withDevice,
} from "../testing/test-support";
import { createEngine, type EngineInternals } from "./engine";
import type { SpaceEngine } from "./space-engine";

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
		TestEngineOptions,
		"settings" | "mcpServersFor" | "connectionNames" | "cliNames" | "findCli"
	> = {},
	internals: EngineInternals = {},
): SpaceEngine {
	return createEngine(
		withDevice({
			db: sandbox.db,
			harnesses: { "claude-code": harness },
			dataDir: sandbox.dataDir,
			scheduler: false,
			...options,
		}),
		internals,
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

function command(id: string, cmd: string): CommandNode {
	return {
		id,
		type: "command",
		position: { x: 0, y: 0 },
		command: cmd,
		output: "text",
	};
}

function flowOf(
	nodes: (AgentNode | CommandNode)[],
	edges: FlowEdge[] = [],
	policy?: Policy,
): Flow {
	return {
		version: 7,
		inputs: [],
		outputs: [],
		start: nodes[0]?.id ?? "",
		nodes,
		edges,
		...(policy ? { policy } : {}),
	};
}

async function projectId(engine: SpaceEngine): Promise<string> {
	return (await engine.addProject({ repoPath: sandbox.repoPath })).id;
}

async function waitForEnd(
	engine: SpaceEngine,
	runId: string,
): Promise<RunDetail> {
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
			'The flow uses the connection "ghost" (planner, builder), but no connection has that name. Add it under Agents → Tools. The flow uses the connection "phantom" (builder), but no connection has that name. Add it under Agents → Tools.',
		);
		expect(await engine.listRuns()).toEqual([]);
		expect(harness.calls).toHaveLength(0);
	});

	test("a Tool node that names a connection the daemon does not have refuses to start too", async () => {
		const engine = makeEngine(fakeHarness(), {
			connectionNames: () => new Set(["tracker"]),
			mcpServersFor: async () => ({ ok: true, servers: {} }),
		});
		const file: ToolNode = {
			id: "file",
			type: "tool",
			position: { x: 0, y: 0 },
			connection: "ghost",
			tool: "create_issue",
			arguments: {},
		};
		await expect(
			engine.startRun({
				projectId: await projectId(engine),
				flow: {
					...flowOf([agent("planner", { connections: ["tracker"] })]),
					nodes: [agent("planner", { connections: ["tracker"] }), file],
					edges: [{ id: "e1", from: "planner", outcome: "pass", to: "file" }],
				},
			}),
		).rejects.toThrow(
			'The flow uses the connection "ghost" (file), but no connection has that name. Add it under Agents → Tools.',
		);
		expect(await engine.listRuns()).toEqual([]);
	});

	test("without connection names, any connection is unknown", async () => {
		const engine = makeEngine(fakeHarness());
		await expect(
			engine.startRun({
				projectId: await projectId(engine),
				flow: flowOf([agent("worker", { connections: ["tracker"] })]),
			}),
		).rejects.toThrow(
			'The flow uses the connection "tracker" (worker), but no connection has that name.',
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

describe("CLI tools at the start", () => {
	test("a CLI tool the daemon does not define starts: this computer has it", async () => {
		const harness = fakeHarness();
		const engine = makeEngine(harness, {
			cliNames: () => new Set(["gh"]),
			findCli: (name) => `/bin/${name}`,
		});
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf([agent("worker", { clis: ["gh", "aws"] })]),
		});
		expect((await waitForEnd(engine, run.id)).status).toBe("finished");
		expect(harness.calls[0]?.clis).toEqual(["gh", "aws"]);
	});

	test("a flow that names a CLI tool this computer does not have refuses to start", async () => {
		const engine = makeEngine(fakeHarness(), {
			cliNames: () => new Set(["gh", "aws"]),
			findCli: (name) => (name === "gh" ? "/bin/gh" : null),
		});
		await expect(
			engine.startRun({
				projectId: await projectId(engine),
				flow: flowOf([agent("worker", { clis: ["gh", "aws"] })]),
			}),
		).rejects.toThrow(
			'The flow uses the CLI tool "aws", but this computer does not have it. Install aws, or remove it from the flow.',
		);
	});

	test("the session gets the node's CLI tools", async () => {
		const harness = fakeHarness();
		const engine = makeEngine(harness, {
			cliNames: () => new Set(["gh"]),
			findCli: (name) => `/bin/${name}`,
		});
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf(
				[agent("worker", { clis: ["gh"] }), agent("other")],
				[{ id: "e1", from: "worker", outcome: "pass", to: "other" }],
			),
		});
		expect((await waitForEnd(engine, run.id)).status).toBe("finished");
		expect(harness.calls.map((c) => c.clis)).toEqual([["gh"], undefined]);
	});

	test("a CLI tool needs no definition, but this computer must have it", async () => {
		const harness = fakeHarness();
		const engine = makeEngine(harness, {
			cliNames: () => new Set(["gh"]),
			findCli: (name) => (name === "jq" ? null : `/bin/${name}`),
		});
		const id = await projectId(engine);
		const run = await engine.startRun({
			projectId: id,
			flow: flowOf([agent("worker", { clis: ["gh", "rg", "gh"] })]),
		});
		expect((await waitForEnd(engine, run.id)).status).toBe("finished");
		expect(harness.calls[0]?.clis).toEqual(["gh", "rg"]);

		await expect(
			engine.startRun({
				projectId: id,
				flow: flowOf([agent("worker", { clis: ["jq"] })]),
			}),
		).rejects.toThrow(
			'The flow uses the CLI tool "jq", but this computer does not have it. Install jq, or remove it from the flow.',
		);
	});
});

describe("mcpServersFor", () => {
	test("the harness gets what mcpServersFor returns for the node", async () => {
		const harness: FakeHarness = fakeHarness();
		const asked: Pick<AgentNode, "connections">[] = [];
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
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf([agent("worker", { connections: ["tracker"] })]),
		});
		expect((await waitForEnd(engine, run.id)).status).toBe("finished");
		expect(asked).toEqual([{ connections: ["tracker"] }]);
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
				"The node uses connections (tracker, docs), but there are none. Add them under Agents → Tools.",
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
			const clock = sleepClock();
			const engine = makeEngine(
				harness,
				{
					settings: mutableSettings({
						policy: {
							usageLimitFirstWaitMinutes: 5,
							usageLimitMaxWaitMinutes: 60,
							networkGraceMinutes: 1,
							idleMinutes: 15,
						},
					}).read,
				},
				{ minuteMs: 100, now: clock.now },
			);
			const run = await engine.startRun({
				projectId: await projectId(engine),
				flow: flowOf([agent("worker")]),
			});
			const detail = await clock.follow(engine, run.id);
			expect(detail.status).toBe("failed");
			// One wait of 1 min fits the grace of 1 min; the next of 2 does not.
			expect(harness.calls).toHaveLength(2);
			expect(detail.steps[0]?.error).toContain("for more than 1 min");
		});

		test("a number the flow sets itself wins over the settings", async () => {
			const harness = networkDown();
			const clock = sleepClock();
			const engine = makeEngine(
				harness,
				{
					settings: mutableSettings({
						policy: {
							usageLimitFirstWaitMinutes: 5,
							usageLimitMaxWaitMinutes: 60,
							networkGraceMinutes: 1,
							idleMinutes: 15,
						},
					}).read,
				},
				{ minuteMs: 100, now: clock.now },
			);
			const run = await engine.startRun({
				projectId: await projectId(engine),
				// Only the grace: the other numbers still come from the settings.
				flow: flowOf([agent("worker")], [], { networkGraceMinutes: 4 }),
			});
			const detail = await clock.follow(engine, run.id);
			expect(detail.status).toBe("failed");
			// Waits of 1 and 2 min fit the grace of 4 min; the next of 5 does not.
			expect(harness.calls).toHaveLength(3);
			expect(detail.steps[0]?.error).toContain("for more than 4 min");
		});
	});
});
