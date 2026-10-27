import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fakeHarness } from "@nightshift/agents/testing";
import { event, run } from "@nightshift/db/schema";
import type { Flow, FlowSources } from "@nightshift/flows";
import { and, eq } from "drizzle-orm";
import {
	createSandbox,
	type Sandbox,
	waitFor,
	withDevice,
} from "../testing/test-support";
import { createEngine } from "./engine";

/** A Run records the Flow revision it runs, and those of the flows it calls (ADR 2). */

const flowOf = (nodes: Flow["nodes"]): Flow => ({
	version: 6,
	inputs: [],
	outputs: [],
	start: nodes[0]?.id ?? "",
	nodes,
	edges: [],
});

const build = flowOf([
	{
		id: "call",
		type: "call",
		position: { x: 0, y: 0 },
		flow: "helper",
		inputs: {},
	},
]);
const helper = flowOf([
	{
		id: "hello",
		type: "command",
		position: { x: 0, y: 0 },
		command: "echo hello",
		output: "text",
	},
]);

let sandbox: Sandbox;
let signal: AbortController;

beforeEach(async () => {
	sandbox = await createSandbox();
	signal = new AbortController();
});

afterEach(async () => {
	signal.abort();
	await sandbox.cleanup();
});

/** An engine whose Device reads these flows, as the flow document gives them. */
function engineWith(sources: FlowSources) {
	const options = withDevice({
		db: sandbox.db,
		harnesses: { "claude-code": fakeHarness() },
		dataDir: sandbox.dataDir,
		scheduler: false,
	});
	return createEngine(
		{ ...options, device: { ...options.device, flows: async () => sources } },
		{ signal: signal.signal },
	).space(sandbox.spaceId);
}

async function startedPayload(runId: string) {
	const [row] = await sandbox.db
		.select({ payload: event.payload })
		.from(event)
		.where(and(eq(event.runId, runId), eq(event.type, "RunStarted")));
	return JSON.parse(row?.payload ?? "{}") as Record<string, unknown>;
}

async function runRow(runId: string) {
	const [row] = await sandbox.db.select().from(run).where(eq(run.id, runId));
	return row;
}

describe("a Run and its Flow revision", () => {
	test("records the revision of its flow and of each flow it calls", async () => {
		const engine = engineWith({
			build: { json: build, revision: "rev-build" },
			helper: { json: helper, revision: "rev-helper" },
		});
		const { id: projectId } = await engine.addProject({
			repoPath: sandbox.repoPath,
		});
		const started = await engine.startRun({ projectId, flowName: "build" });

		const row = await runRow(started.id);
		expect(row?.flowRevision).toBe("rev-build");
		expect(JSON.parse(row?.bodyFlowRevisions ?? "")).toEqual({
			helper: "rev-helper",
		});
		await waitFor(async () => (await startedPayload(started.id)).projectId);
		expect((await startedPayload(started.id)).flowRevision).toBe("rev-build");
	});

	test("a flow without a revision, and a flow the start sends, record none", async () => {
		const engine = engineWith({
			build: { json: build },
			helper: { json: helper },
		});
		const { id: projectId } = await engine.addProject({
			repoPath: sandbox.repoPath,
		});
		for (const input of [
			{ projectId, flowName: "build" },
			{ projectId, flow: helper },
		]) {
			const started = await engine.startRun(input);
			const row = await runRow(started.id);
			expect(row?.flowRevision).toBeNull();
			expect(row?.bodyFlowRevisions).toBe("{}");
			expect(await startedPayload(started.id)).not.toHaveProperty(
				"flowRevision",
			);
		}
	});
});
