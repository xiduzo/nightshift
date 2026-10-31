import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { AgentHarness } from "@nightshift/agents/types";
import { runLease } from "@nightshift/db/schema";
import type {
	AgentNode,
	Flow,
	FlowEdge,
	FlowNode,
	LeaseNode,
	WaitNode,
} from "@nightshift/flows";
import {
	defaultRunSettings,
	type RunSettings,
} from "../device-config/settings";
import { createRunLog, type RunLog } from "../log/run-log";
import type { RunDetail } from "../read/views";
import {
	createSandbox,
	expectRunLogsInSync,
	type Sandbox,
	scriptedHarness,
	type TestEngineOptions,
	waitFor,
	withDevice,
} from "../testing/test-support";
import { createEngine, type EngineInternals } from "./engine";
import type { SpaceEngine } from "./space-engine";

/**
 * Leases through the engine's public seam (ADR 7): two runs that contend
 * for one name, and the engine letting go of a lease on every end of a
 * run. A minute lasts 20 ms here.
 */

const MINUTE_MS = 20;

let sandbox: Sandbox;
let runLogs: RunLog[];
beforeEach(async () => {
	sandbox = await createSandbox();
	runLogs = [];
});
afterEach(async () => {
	try {
		await expectRunLogsInSync(sandbox.db, runLogs);
	} finally {
		await sandbox.cleanup();
	}
});

function makeEngine(
	harness: AgentHarness = scriptedHarness().harness,
	options: Pick<TestEngineOptions, "settings"> = {},
	internals: EngineInternals = {},
): SpaceEngine {
	const runLog = createRunLog(sandbox.db, { walkerId: sandbox.deviceId });
	runLogs.push(runLog);
	return createEngine(
		withDevice({
			db: sandbox.db,
			harnesses: { "claude-code": harness },
			deviceId: sandbox.deviceId,
			dataDir: sandbox.dataDir,
			...options,
		}),
		{ runLog, minuteMs: MINUTE_MS, ...internals },
	).space(sandbox.spaceId);
}

const at = { x: 0, y: 0 };
const lease = (extra: Partial<LeaseNode> = {}): LeaseNode => ({
	id: "own",
	type: "lease",
	position: at,
	name: "zac-docker-stack",
	...extra,
});
const waitFor_ = (name: string): WaitNode => ({
	id: "hold",
	type: "wait",
	position: at,
	until: { kind: "signal", name },
});
const edge = (from: string, outcome: string, to: string): FlowEdge => ({
	id: `${from}-${outcome}`,
	from,
	outcome,
	to,
});
const flowOf = (nodes: FlowNode[], edges: FlowEdge[]): Flow => ({
	version: 7,
	inputs: [],
	outputs: [],
	start: nodes[0]?.id ?? "",
	nodes,
	edges,
});

/** An Agent step whose harness the test drives. */
const work: AgentNode = {
	id: "work",
	type: "agent",
	position: at,
	prompt: "Go",
	harness: "claude-code",
	model: "sonnet",
	permissionMode: "acceptEdits",
	session: "fresh",
};

/** Takes the lease, then holds it until the run gets the signal `go`. */
const holdingFlow = (extra: Partial<LeaseNode> = {}) =>
	flowOf([lease(extra), waitFor_("go")], [edge("own", "held", "hold")]);

/** Takes the lease, and ends `nothing-to-do` when another run holds it. */
const politeFlow = (extra: Partial<LeaseNode> = {}) =>
	flowOf(
		[
			lease(extra),
			{
				id: "done",
				type: "end",
				position: at,
				status: "done",
				message: "Took it",
			},
			{
				id: "skip",
				type: "end",
				position: at,
				status: "nothing-to-do",
				message: "{{own.holder_title}} holds the stack",
			},
		],
		[edge("own", "held", "done"), edge("own", "busy", "skip")],
	);

async function projectId(engine: SpaceEngine): Promise<string> {
	return (await engine.addProject({ repoPath: sandbox.repoPath })).id;
}

async function statusOf(engine: SpaceEngine, runId: string, status: string) {
	return waitFor(
		async () => {
			const detail = await engine.getRun(runId);
			return detail.status === status ? detail : null;
		},
		{ label: `run ${runId} to be ${status}` },
	);
}

async function endOf(engine: SpaceEngine, runId: string): Promise<RunDetail> {
	return waitFor(
		async () => {
			const detail = await engine.getRun(runId);
			return ["running", "sleeping", "waiting"].includes(detail.status)
				? null
				: detail;
		},
		{ label: "the run to end" },
	);
}

/** The run that holds each lease of the Space now. */
async function holders(): Promise<Record<string, string>> {
	const rows = await sandbox.db.select().from(runLease);
	return Object.fromEntries(
		rows
			.filter((row) => row.expiresAt.getTime() > Date.now())
			.map((row) => [row.name, row.runId]),
	);
}

/** Starts a run that takes the lease and sleeps holding it. */
async function holdingRun(engine: SpaceEngine, flow = holdingFlow()) {
	const run = await engine.startRun({
		projectId: await projectId(engine),
		flow,
	});
	await statusOf(engine, run.id, "sleeping");
	expect(await holders()).toEqual({ "zac-docker-stack": run.id });
	return run;
}

describe("two runs and one lease", () => {
	test("given a run that holds the lease, when another run takes it without a wait, then it ends nothing-to-do and names the holder", async () => {
		const engine = makeEngine();
		const first = await holdingRun(engine);
		const second = await engine.startRun({
			projectId: await projectId(engine),
			flow: politeFlow(),
		});
		const ended = await endOf(engine, second.id);
		expect(ended.status).toBe("finished");
		expect(ended.result).toBe("nothing-to-do");
		expect(ended.steps[0]?.outputs).toMatchObject({
			holder: first.id,
			holder_title: first.title,
		});
		expect(await holders()).toEqual({ "zac-docker-stack": first.id });
	});

	test("given a run that waits for the lease, when the holder ends, then the waiting run takes it at once", async () => {
		const engine = makeEngine();
		const first = await holdingRun(engine);
		const second = await engine.startRun({
			projectId: await projectId(engine),
			flow: politeFlow({ waitMinutes: 1_000 }),
		});
		await statusOf(engine, second.id, "sleeping");
		await engine.act(first.id, { kind: "signal", name: "go" });
		expect((await endOf(engine, first.id)).status).toBe("finished");
		const ended = await endOf(engine, second.id);
		expect(ended.result).toBe("done");
		expect(await holders()).toEqual({});
	});
});

describe("the engine lets go of a lease on every end", () => {
	test("given a run that holds the lease, when it ends done, then the lease is free", async () => {
		const engine = makeEngine();
		const run = await holdingRun(engine);
		await engine.act(run.id, { kind: "signal", name: "go" });
		await endOf(engine, run.id);
		expect(await holders()).toEqual({});
	});

	test("given a run that holds the lease, when a person stops it, then the lease is free", async () => {
		const engine = makeEngine();
		const run = await holdingRun(engine);
		await engine.act(run.id, { kind: "stop" });
		expect((await endOf(engine, run.id)).status).toBe("stopped");
		expect(await holders()).toEqual({});
	});

	test("given a run that holds the lease, when a step fails, then the lease is free", async () => {
		const engine = makeEngine();
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf(
				[
					lease(),
					{
						id: "check",
						type: "command",
						position: at,
						command: "exit 3",
						output: "text",
					},
				],
				[edge("own", "held", "check")],
			),
		});
		expect((await endOf(engine, run.id)).status).toBe("failed");
		expect(await holders()).toEqual({});
	});

	test("given a run the daemon died in, when it does not continue on its own, then the lease is free", async () => {
		const dying = scriptedHarness({ hang: true });
		const first = makeEngine(dying.harness);
		const run = await first.startRun({
			projectId: await projectId(first),
			flow: flowOf([lease(), work], [edge("own", "held", "work")]),
		});
		await waitFor(() => dying.sessions[0], { label: "the session" });
		expect(await holders()).toEqual({ "zac-docker-stack": run.id });

		const second = makeEngine(
			scriptedHarness().harness,
			{ settings: settingsWith({ resumeInterruptedRuns: false }) },
			{ resumeGraceMs: 0 },
		);
		expect((await second.getRun(run.id)).status).toBe("interrupted");
		await waitFor(async () => Object.keys(await holders()).length === 0, {
			label: "the lease to be free",
		});
	});

	test("given a run the daemon died in, when it continues on its own, then it keeps the lease", async () => {
		const dying = scriptedHarness({ hang: true });
		const first = makeEngine(dying.harness);
		const run = await first.startRun({
			projectId: await projectId(first),
			flow: flowOf([lease(), work], [edge("own", "held", "work")]),
		});
		await waitFor(() => dying.sessions[0], { label: "the session" });

		const { harness, sessions } = scriptedHarness();
		const second = makeEngine(harness, {}, { resumeGraceMs: 0 });
		const resumed = await waitFor(() => sessions[0], { label: "the resume" });
		expect(await holders()).toEqual({ "zac-docker-stack": run.id });
		resumed.finish();
		expect((await endOf(second, run.id)).status).toBe("finished");
		expect(await holders()).toEqual({});
	});
});

const settingsWith = (patch: Partial<RunSettings>) => (): RunSettings => ({
	...defaultRunSettings(),
	...patch,
});
