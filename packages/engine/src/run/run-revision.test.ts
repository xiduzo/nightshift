import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fakeHarness } from "@nightshift/agents/testing";
import { event, run } from "@nightshift/db/schema";
import type { Flow } from "@nightshift/flows";
import { and, eq } from "drizzle-orm";
import type * as Y from "yjs";
import {
	createFlowDocuments,
	type FlowDocument,
	type FlowDocuments,
	flowIdOf,
	flowRevisions,
} from "../flows/flow-document";
import { seedFlows } from "../testing/seed-flows";
import {
	createSandbox,
	type Sandbox,
	waitFor,
	withDevice,
} from "../testing/test-support";
import { createEngine } from "./engine";

/** A Run records the Flow revision it runs, and those of the flows it calls (ADR 2). */

const flowOf = (nodes: Flow["nodes"]): Flow => ({
	version: 7,
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

/** An engine over its own flow documents, which a test also reads and changes. */
function engineWith(flowDocuments: FlowDocuments) {
	return createEngine(
		withDevice({
			db: sandbox.db,
			harnesses: { "claude-code": fakeHarness() },
			dataDir: sandbox.dataDir,
			scheduler: false,
			flowDocuments,
		}),
		{ signal: signal.signal },
	).space(sandbox.spaceId);
}

/** The id of the last revision of the flow of that name. */
function lastRevision(document: FlowDocument, name: string): string {
	const revision = flowRevisions(document, flowIdOf(document, name) ?? "").at(
		-1,
	);
	if (!revision) throw new Error(`The flow "${name}" has no revision.`);
	return revision.id;
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
		const documents = createFlowDocuments({ db: sandbox.db });
		const engine = engineWith(documents);
		const { id: projectId } = await engine.addProject({
			repoPath: sandbox.repoPath,
		});
		await seedFlows(engine, projectId, { build, helper });
		const document = await documents.open(projectId);

		const started = await engine.startRun({ projectId, flowName: "build" });

		const row = await runRow(started.id);
		expect(row?.flowRevision).toBe(lastRevision(document, "build"));
		expect(JSON.parse(row?.bodyFlowRevisions ?? "")).toEqual({
			helper: lastRevision(document, "helper"),
		});
		await waitFor(async () => (await startedPayload(started.id)).projectId);
		expect((await startedPayload(started.id)).flowRevision).toBe(
			lastRevision(document, "build"),
		);
		// The run details show the revision the run ran.
		expect((await engine.getRun(started.id)).flowRevision).toBe(
			lastRevision(document, "build"),
		);
	});

	test("a flow that a merge changed since its last revision, and a flow the start sends, record none", async () => {
		const documents = createFlowDocuments({ db: sandbox.db });
		const engine = engineWith(documents);
		const { id: projectId } = await engine.addProject({
			repoPath: sandbox.repoPath,
		});
		await seedFlows(engine, projectId, { build, helper });
		const document = await documents.open(projectId);
		// What a Link brings: an edit of another Device that no revision here records.
		for (const name of ["build", "helper"]) {
			const flow = document.flows.get(flowIdOf(document, name) ?? "");
			const scalars = (flow as Y.Map<unknown>).get("scalars") as Y.Map<unknown>;
			await document.current.change(() => scalars.set("description", "Merged"));
		}

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
