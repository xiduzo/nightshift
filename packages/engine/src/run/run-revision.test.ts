import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fakeHarness } from "@nightshift/agents/testing";
import { event, run } from "@nightshift/db/schema";
import type { Flow } from "@nightshift/flows";
import { and, eq } from "drizzle-orm";
import * as Y from "yjs";
import { createProjectFlows } from "../flows";
import {
	createFlowDocuments,
	type FlowDocuments,
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

/** An engine over its own flow documents, which a test also syncs with another Device's. */
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

/** The id of the revision the flow of that name is now. */
async function lastRevision(
	engine: ReturnType<typeof engineWith>,
	projectId: string,
	name: string,
): Promise<string> {
	const [revision] = await engine.flows.revisions(projectId, name);
	if (!revision?.current) throw new Error(`The flow "${name}" is no revision.`);
	return revision.id;
}

/** What a Link does: each side gets what the other has of the project's flow documents. */
async function sync(a: FlowDocuments, b: FlowDocuments, projectId: string) {
	const [left, right] = [await a.open(projectId), await b.open(projectId)];
	for (const [x, y] of [
		[left.current.doc, right.current.doc],
		[left.history.doc, right.history.doc],
	] as const) {
		Y.applyUpdate(y, Y.encodeStateAsUpdate(x, Y.encodeStateVector(y)), "link");
		Y.applyUpdate(x, Y.encodeStateAsUpdate(y, Y.encodeStateVector(x)), "link");
	}
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
		const revision = await lastRevision(engine, projectId, "build");

		const started = await engine.startRun({ projectId, flowName: "build" });

		const row = await runRow(started.id);
		expect(row?.flowRevision).toBe(revision);
		expect(JSON.parse(row?.bodyFlowRevisions ?? "")).toEqual({
			helper: await lastRevision(engine, projectId, "helper"),
		});
		await waitFor(async () => (await startedPayload(started.id)).projectId);
		expect((await startedPayload(started.id)).flowRevision).toBe(revision);
		// The run details show the revision the run ran.
		expect((await engine.getRun(started.id)).flowRevision).toBe(revision);
	});

	test("a flow that a merge changed since its last revision, and a flow the start sends, record none", async () => {
		const documents = createFlowDocuments({ db: sandbox.db });
		const engine = engineWith(documents);
		const { id: projectId } = await engine.addProject({
			repoPath: sandbox.repoPath,
		});
		await seedFlows(engine, projectId, { build, helper });
		// Another Device edits the description, this one a node, at the
		// same time: the Link merges both, which no revision records.
		const other = await createSandbox();
		const desktop = createFlowDocuments({ db: other.db });
		try {
			const desktopFlows = createProjectFlows({
				documents: desktop,
				project: async () => ({ spaceId: other.spaceId }),
				deviceId: other.deviceId,
			});
			await sync(documents, desktop, projectId);
			for (const [name, flow] of [
				["build", build],
				["helper", helper],
			] as const) {
				await desktopFlows.save(projectId, name, {
					...flow,
					description: "On the desktop",
				});
				await engine.flows.save(projectId, name, {
					...flow,
					nodes: flow.nodes.map((node) => ({
						...node,
						position: { x: 10, y: 10 },
					})),
				});
			}
			await sync(documents, desktop, projectId);
		} finally {
			await desktop.close();
			await other.cleanup();
		}
		expect(await engine.flows.get(projectId, "build")).toMatchObject({
			flow: { description: "On the desktop", nodes: [{ position: { x: 10 } }] },
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
