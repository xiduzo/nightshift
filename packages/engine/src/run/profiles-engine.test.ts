import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fakeDecider, fakeHarness } from "@nightshift/agents/testing";
import type { AgentHarness, HarnessName } from "@nightshift/agents/types";
import type {
	AgentNode,
	AgentProfileSettings,
	DecisionNode,
	Flow,
	FlowEdge,
	Profile,
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

/** Profiles, on this computer and in the project: resolved into the run's copy when a run starts. */

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
		"profileFor" | "harnessNames" | "cliNames" | "findCli" | "decider"
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

function flowOf(
	nodes: (AgentNode | DecisionNode)[],
	edges: FlowEdge[] = [],
): Flow {
	return {
		version: 6,
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
			'The flow uses the profile "planner" (plan), but no profile has that name. Add it under Agents, or to the project\'s profiles.',
		);
		expect(await engine.listRuns()).toEqual([]);
		expect(harness.calls).toHaveLength(0);
	});
});

/** Writes the project's `.nightshift/profiles.json`. */
async function projectProfiles(profiles: unknown[]): Promise<void> {
	await mkdir(join(sandbox.repoPath, ".nightshift"), { recursive: true });
	await writeFile(
		join(sandbox.repoPath, ".nightshift", "profiles.json"),
		JSON.stringify({ version: 1, profiles }),
	);
}

const triage = (extra: Partial<DecisionNode> = {}): DecisionNode => ({
	id: "triage",
	type: "decision",
	position: { x: 0, y: 0 },
	prompt: "Is it small?",
	options: [{ name: "yes" }, { name: "no" }],
	by: "model",
	profile: "small",
	...extra,
});

describe("the project's profiles", () => {
	const projectBuilder: Profile = {
		name: "builder",
		harness: "claude-code",
		model: "haiku",
		permissionMode: "acceptEdits",
		clis: [],
		connections: [],
	};

	test("a flow runs on a computer without the profile when the project has it", async () => {
		await projectProfiles([projectBuilder]);
		const harness = fakeHarness();
		const engine = makeEngine({ "claude-code": harness });
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf([agent("worker")]),
		});
		expect((await waitForEnd(engine, run.id)).status).toBe("finished");
		expect(harness.calls[0]).toMatchObject({
			model: "haiku",
			permissionMode: "acceptEdits",
		});
	});

	test("the computer's profile of the same name wins", async () => {
		await projectProfiles([projectBuilder]);
		const harness = fakeHarness();
		const engine = makeEngine(
			{ "claude-code": harness },
			{ profileFor: (name) => (name === "builder" ? builder : null) },
		);
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf([agent("worker")]),
		});
		await waitForEnd(engine, run.id);
		expect(harness.calls[0]?.model).toBe("opus");
	});

	test("a broken profiles file says why its profile is missing", async () => {
		await projectProfiles([{ name: "builder", harness: "claude-code" }]);
		const engine = makeEngine({ "claude-code": fakeHarness() });
		await expect(
			engine.startRun({
				projectId: await projectId(engine),
				flow: flowOf([agent("worker")]),
			}),
		).rejects.toThrow('The profile "builder" is not valid.');
	});
});

describe("model profiles", () => {
	test("a Decision by a model asks the decider and the model of its profile", async () => {
		await projectProfiles([
			{ name: "small", decider: "ollama", model: "qwen3:4b" },
		]);
		const decider = fakeDecider([{ label: "yes" }]);
		const engine = makeEngine({}, { decider });
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf([triage()]),
		});
		expect((await waitForEnd(engine, run.id)).status).toBe("finished");
		expect(decider.calls[0]).toMatchObject({
			decider: "ollama",
			model: "qwen3:4b",
		});
		expect((await engine.getRun(run.id)).flow.nodes[0]).toMatchObject({
			profile: "small",
			decider: "ollama",
		});
	});

	test("the node's own decider and model still work, and win", async () => {
		const decider = fakeDecider([{ label: "no" }]);
		const engine = makeEngine(
			{},
			{
				decider,
				profileFor: (name) =>
					name === "small" ? { decider: "openai", model: "gpt-6-luna" } : null,
			},
		);
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf([triage({ decider: "ollaya" })]),
		});
		await waitForEnd(engine, run.id);
		expect(decider.calls[0]?.decider).toBe("ollaya");
		// The profile's model belongs to its own decider.
		expect(decider.calls[0]?.model).not.toBe("gpt-6-luna");
	});

	test("a profile of the wrong kind refuses the run", async () => {
		const engine = makeEngine(
			{ "claude-code": fakeHarness() },
			{
				profileFor: (name) =>
					name === "small" ? { decider: "ollama" } : builder,
			},
		);
		await expect(
			engine.startRun({
				projectId: await projectId(engine),
				flow: flowOf([agent("worker", { profile: "small" })]),
			}),
		).rejects.toThrow(
			'The Agent node "worker" names the profile "small", which is for Decision and Value nodes. Pick an agent profile.',
		);
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
		const { id } = await store.save({
			...builder,
			name: "builder",
			description: "Builds.",
		});
		// After a restart.
		const again = createProfileStore({
			document: await sandbox.openDocument(),
		});
		await again.load();
		expect(again.list().map((p) => [p.id, p.name])).toEqual([[id, "builder"]]);
		expect(again.get(id)?.description).toBe("Builds.");
		expect(again.byName("builder")?.id).toBe(id);
		expect(again.settingsFor(id)).toEqual(builder);
		await again.remove(id);
		expect(again.settingsFor(id)).toBeNull();
		const third = createProfileStore({
			document: await sandbox.openDocument(),
		});
		expect(third.list()).toEqual([]);
	});

	test("a profile saved before ids reads with its name as its id, and keeps that id on a rename", async () => {
		const document = await sandbox.openDocument();
		await document.change(() => {
			document.profiles.set("builder", {
				description: "Builds.",
				settings: builder,
				updatedAt: 1,
			});
		});
		const store = createProfileStore({ document });
		await store.load();
		expect(store.list()).toMatchObject([
			{ id: "builder", name: "builder", description: "Builds." },
		]);
		expect(store.settingsFor("builder")).toEqual(builder);

		const renamed = await store.save({ ...builder, name: "maker" }, "builder");
		expect(renamed.id).toBe("builder");
		expect(store.byName("maker")?.id).toBe("builder");
		expect(store.byName("builder")).toBeNull();
		expect([...document.profiles.keys()]).toEqual(["builder"]);
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
