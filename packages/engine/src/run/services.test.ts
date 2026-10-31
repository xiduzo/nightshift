import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	CommandNode,
	Flow,
	FlowEdge,
	FlowNode,
	ServiceNode,
	WaitNode,
} from "@nightshift/flows";

import { createRunLog, type RunLog } from "../log/run-log";
import type { RunDetail } from "../read/views";
import {
	createSandbox,
	expectRunLogsInSync,
	type Sandbox,
	scriptedHarness,
	waitFor,
	withDevice,
} from "../testing/test-support";
import { createEngine, type EngineInternals } from "./engine";
import type { SpaceEngine } from "./space-engine";

/**
 * Services through the engine's public seam (ADR 9), with a real Bun web
 * server: a Service node starts it, a later step reads its address and
 * its log, and the engine stops it on every end of the run. A minute lasts
 * 20 ms and a second of a probe 20 ms here.
 */

const MINUTE_MS = 20;
const SECOND_MS = 20;
const BUN = process.execPath;

let sandbox: Sandbox;
let runLogs: RunLog[];
let dir: string;
beforeEach(async () => {
	sandbox = await createSandbox();
	runLogs = [];
	dir = mkdtempSync(join(tmpdir(), "nightshift-services-"));
	writeFileSync(join(dir, "server.ts"), server(dir));
});
afterEach(async () => {
	try {
		await expectRunLogsInSync(sandbox.db, runLogs);
	} finally {
		await sandbox.cleanup();
		rmSync(dir, { recursive: true, force: true });
	}
});

/** Listens on any free port, writes the port to `<dir>/port`, says so on stdout. */
function server(at: string): string {
	return `
const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("hello from the stack") });
require("node:fs").writeFileSync(${JSON.stringify(join(at, "port"))}, String(server.port));
console.log("listening on " + server.port);
setInterval(() => {}, 1000);
`;
}

function makeEngine(internals: EngineInternals = {}): SpaceEngine {
	const runLog = createRunLog(sandbox.db, { walkerId: sandbox.deviceId });
	runLogs.push(runLog);
	return createEngine(
		withDevice({
			db: sandbox.db,
			harnesses: { "claude-code": scriptedHarness().harness },
			deviceId: sandbox.deviceId,
			dataDir: sandbox.dataDir,
		}),
		{ runLog, minuteMs: MINUTE_MS, secondMs: SECOND_MS, ...internals },
	).space(sandbox.spaceId);
}

const at = { x: 0, y: 0 };

/** The web server, ready when it answers; its address is the step's data. */
const stack = (extra: Partial<ServiceNode> = {}): ServiceNode => ({
	id: "stack",
	type: "service",
	position: at,
	start: `"${BUN}" "${join(dir, "server.ts")}"`,
	ready: {
		command: `"${BUN}" -e 'const p = require("node:fs").readFileSync(${JSON.stringify(join(dir, "port"))}, "utf8"); const r = await fetch("http://127.0.0.1:" + p); if (!r.ok) process.exit(1); require("node:fs").writeFileSync(process.env.NS_OUTPUT, JSON.stringify({ url: "http://127.0.0.1:" + p }));'`,
		everySeconds: 1,
		timeoutMinutes: 1,
	},
	...extra,
});

const command = (id: string, text: string): CommandNode => ({
	id,
	type: "command",
	position: at,
	command: text,
	output: "text",
});

/** Reads the stack's address and its log, as a test against the stack does. */
const useStack = () =>
	command(
		"test",
		`"${BUN}" -e 'const r = await fetch(process.argv.at(-1)); require("node:fs").writeFileSync(${JSON.stringify(join(dir, "answer"))}, await r.text());' "{{stack.data.url}}" && printf '%s' "{{stack.log_tail}}" > "${join(dir, "tail")}"`,
	);

const waitForSignal: WaitNode = {
	id: "hold",
	type: "wait",
	position: at,
	until: { kind: "signal", name: "go" },
};

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

async function start(engine: SpaceEngine, flow: Flow) {
	const projectId = (await engine.addProject({ repoPath: sandbox.repoPath }))
		.id;
	return engine.startRun({ projectId, flow });
}

async function statusOf(engine: SpaceEngine, runId: string, status: string) {
	return waitFor(
		async () => {
			const detail = await engine.getRun(runId);
			return detail.status === status ? detail : null;
		},
		{ label: `run ${runId} to be ${status}`, timeoutMs: 20_000 },
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
		{ label: "the run to end", timeoutMs: 20_000 },
	);
}

function stackUrl(): string {
	return `http://127.0.0.1:${readFileSync(join(dir, "port"), "utf8")}`;
}

async function answers(url: string): Promise<boolean> {
	try {
		return (await fetch(url, { signal: AbortSignal.timeout(500) })).ok;
	} catch {
		return false;
	}
}

async function stopsAnswering(url: string): Promise<void> {
	await waitFor(async () => !(await answers(url)), {
		label: "the stack to stop",
	});
}

describe("a Service node", () => {
	test("given a stack that gets ready, when a later step reads its address and its log, then the step reaches it, and the stack stops when the run is done", async () => {
		const engine = makeEngine();
		const run = await start(
			engine,
			flowOf([stack(), useStack()], [edge("stack", "ready", "test")]),
		);

		const ended = await endOf(engine, run.id);

		expect(ended.status).toBe("finished");
		expect(readFileSync(join(dir, "answer"), "utf8")).toBe(
			"hello from the stack",
		);
		expect(readFileSync(join(dir, "tail"), "utf8")).toContain("listening on");
		expect(ended.steps[0]?.outputs).toMatchObject({
			outcome: "ready",
			data: { url: stackUrl() },
		});
		await stopsAnswering(stackUrl());
	});

	test("given a stack that never gets ready, when the time runs out, then the step ends failed, the run fails and the stack stops", async () => {
		const engine = makeEngine();
		const run = await start(
			engine,
			flowOf(
				[
					stack({
						ready: { command: "exit 1", everySeconds: 1, timeoutMinutes: 1 },
					}),
				],
				[],
			),
		);

		const ended = await endOf(engine, run.id);

		expect(ended.status).toBe("failed");
		expect(ended.steps[0]?.outcome).toBe("failed");
		await stopsAnswering(stackUrl());
	});
});

describe("the engine stops a service on every end", () => {
	async function readyRun(engine: SpaceEngine, flow: Flow) {
		const run = await start(engine, flow);
		await waitFor(() => existsSync(join(dir, "port")), {
			label: "the stack to start",
		});
		return run;
	}

	test("given a run with a stack, when a person stops it, then the stack stops", async () => {
		const engine = makeEngine();
		const run = await readyRun(
			engine,
			flowOf([stack(), waitForSignal], [edge("stack", "ready", "hold")]),
		);
		await statusOf(engine, run.id, "sleeping");
		expect(await answers(stackUrl())).toBe(true);

		await engine.act(run.id, { kind: "stop" });

		expect((await endOf(engine, run.id)).status).toBe("stopped");
		await stopsAnswering(stackUrl());
	});

	test("given a run with a stack, when a later step fails, then the stack stops", async () => {
		const engine = makeEngine();
		const run = await readyRun(
			engine,
			flowOf(
				[stack(), command("check", "exit 3")],
				[edge("stack", "ready", "check")],
			),
		);

		expect((await endOf(engine, run.id)).status).toBe("failed");
		await stopsAnswering(stackUrl());
	});

	test("given a stack with a stop command, when the run is done, then the stop command runs", async () => {
		const engine = makeEngine();
		const run = await readyRun(
			engine,
			flowOf(
				[
					stack({ stop: `touch "${join(dir, "stop-ran")}"` }),
					command("check", "true"),
				],
				[edge("stack", "ready", "check")],
			),
		);

		expect((await endOf(engine, run.id)).status).toBe("finished");
		await stopsAnswering(stackUrl());
		expect(existsSync(join(dir, "stop-ran"))).toBe(true);
	});
});
