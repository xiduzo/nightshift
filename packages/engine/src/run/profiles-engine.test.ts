import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fakeHarness } from "@nightshift/agents/testing";
import type { AgentHarness, HarnessName } from "@nightshift/agents/types";
import type {
	AgentNode,
	AgentProfileSettings,
	Flow,
	FlowEdge,
} from "@nightshift/flows";
import { createProfileStore } from "../device-config/profiles";
import type { RunDetail } from "../read/views";
import {
	createSandbox,
	type Sandbox,
	type TestEngineOptions,
	waitFor,
	withDevice,
} from "../testing/test-support";
import { createEngine } from "./engine";
import type { SpaceEngine } from "./space-engine";

/** Agent Profiles: resolved into the run's copy when a run starts. */

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

const builder: AgentProfileSettings = {
	harness: "claude-code",
	model: "opus",
	effort: "max",
	permissionMode: "auto",
	clis: ["gh"],
	connections: [],
};

function makeEngine(
	harnesses: Partial<Record<HarnessName, AgentHarness>>,
	options: Pick<
		TestEngineOptions,
		"profileFor" | "harnessNames" | "cliNames" | "findCli"
	> = {},
): SpaceEngine {
	return createEngine(
		withDevice({
			db: sandbox.db,
			harnesses,
			dataDir: sandbox.dataDir,
			scheduler: false,
			cliNames: () => new Set(["gh"]),
			findCli: (name) => `/usr/local/bin/${name}`,
			...options,
		}),
	).space(sandbox.spaceId);
}

function agent(id: string, extra: Partial<AgentNode> = {}): AgentNode {
	return {
		id,
		type: "agent",
		position: { x: 0, y: 0 },
		prompt: `Work as ${id}.`,
		profile: "builder",
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
): Promise<RunDetail> {
	return waitFor(
		async () => {
			const detail = await engine.getRun(runId);
			return detail.status === "running" ? null : detail;
		},
		{ label: "the run to end", timeoutMs: 10_000 },
	);
}

describe("profiles at the start", () => {
	test("the session runs with the profile's harness, model, effort, permission mode and CLI tools", async () => {
		const harness = fakeHarness();
		const engine = makeEngine(
			{ "claude-code": harness },
			{ profileFor: (name) => (name === "builder" ? builder : null) },
		);
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf([agent("worker", { model: "sonnet" })]),
		});
		expect((await waitForEnd(engine, run.id)).status).toBe("finished");
		expect(harness.calls[0]).toMatchObject({
			// The node's own model wins over the profile's.
			model: "sonnet",
			effort: "max",
			permissionMode: "auto",
			clis: ["gh"],
		});
	});

	test("a later change to the profile does not reach a run that started", async () => {
		let profile = builder;
		const harness = fakeHarness();
		const engine = makeEngine(
			{ "claude-code": harness },
			{ profileFor: () => profile },
		);
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf([agent("worker")]),
		});
		profile = { ...builder, model: "haiku" };
		await waitForEnd(engine, run.id);
		expect(harness.calls[0]?.model).toBe("opus");
		const detail = await engine.getRun(run.id);
		expect(detail.flow.nodes[0]).toMatchObject({
			profile: "builder",
			model: "opus",
		});
	});

	test("a flow that names a profile the daemon does not have refuses to start", async () => {
		const harness = fakeHarness();
		const engine = makeEngine(
			{ "claude-code": harness },
			{ profileFor: (name) => (name === "builder" ? builder : null) },
		);
		await expect(
			engine.startRun({
				projectId: await projectId(engine),
				flow: flowOf(
					[agent("plan", { profile: "planner" }), agent("work")],
					[{ id: "e1", from: "plan", outcome: "pass", to: "work" }],
				),
			}),
		).rejects.toThrow(
			'The flow uses the profile "planner" (plan), but no profile has that name. Add it under Agents.',
		);
		expect(await engine.listRuns()).toEqual([]);
		expect(harness.calls).toHaveLength(0);
	});
});

describe("added harnesses", () => {
	test("a harness that is not added cannot run an Agent node", async () => {
		const engine = makeEngine(
			{ "claude-code": fakeHarness() },
			{
				profileFor: () => builder,
				harnessNames: () => new Set(["opencode"]),
			},
		);
		await expect(
			engine.startRun({
				projectId: await projectId(engine),
				flow: flowOf([agent("worker")]),
			}),
		).rejects.toThrow(
			"The flow has an Agent node on Claude Code (worker), but no Claude Code harness is added. Add it under Agents.",
		);
	});
});

describe("createProfileStore", () => {
	test("saves, reloads, resolves and removes a profile", async () => {
		const document = await sandbox.openDocument();
		const store = createProfileStore({ document });
		await store.load();
		await store.save({ ...builder, name: "builder", description: "Builds." });
		// After a restart.
		const again = createProfileStore({
			document: await sandbox.openDocument(),
		});
		await again.load();
		expect(again.list().map((p) => p.name)).toEqual(["builder"]);
		expect(again.get("builder")?.description).toBe("Builds.");
		expect(again.settingsFor("builder")).toEqual(builder);
		await again.remove("builder");
		expect(again.settingsFor("builder")).toBeNull();
		const third = createProfileStore({
			document: await sandbox.openDocument(),
		});
		expect(third.list()).toEqual([]);
	});

	test("refuses a profile with a name a node cannot use", async () => {
		const store = createProfileStore({
			document: await sandbox.openDocument(),
		});
		await expect(
			store.save({ ...builder, name: "Not A Name" }),
		).rejects.toThrow();
	});
});
