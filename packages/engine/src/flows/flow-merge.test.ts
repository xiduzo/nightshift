import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	type Flow,
	flowSchema,
	type Schedule,
	scheduleSchema,
	singleAgentFlow,
} from "@nightshift/flows";
import * as Y from "yjs";
import { createSandbox, type Sandbox } from "../testing/test-support";
import {
	createFlowDocuments,
	type FlowDocument,
	type FlowDocuments,
	flowIdOf,
	flowRevisions,
	flowSources,
	saveFlow,
} from "./flow-document";
import { flowsMerged, mergeFlowDocuments, planFlowMerge } from "./flow-merge";

let sandbox: Sandbox;
let documents: FlowDocuments;
/** The Project of the Device's own Space, and the Project with its remote in the Host's. */
let local: FlowDocument;
let hosted: FlowDocument;
const LOCAL = "ada-local";
const HOSTED = "ada-hosted";

beforeEach(async () => {
	sandbox = await createSandbox();
	documents = createFlowDocuments({ db: sandbox.db });
	local = await documents.open("p-local");
	hosted = await documents.open("p-hosted");
});
afterEach(async () => {
	await documents.close();
	await sandbox.cleanup();
});

const flowWith = (prompt: string): Flow =>
	flowSchema.parse(
		singleAgentFlow({ prompt, model: "sonnet", permissionMode: "acceptEdits" }),
	);

async function save(
	document: FlowDocument,
	name: string,
	prompt: string,
	at: number,
	personId: string,
) {
	await saveFlow(document, {
		name,
		flow: flowWith(prompt),
		kind: "save",
		personId,
		deviceId: sandbox.deviceId,
		at,
	});
}

async function schedule(document: FlowDocument, input: Partial<Schedule>) {
	const parsed = scheduleSchema.parse({ cron: "0 22 * * *", ...input });
	await document.current.change(() => {
		document.schedules.set(parsed.id, parsed);
		document.scheduleOrder.push([parsed.id]);
	});
}

const schedulesOf = (document: FlowDocument) =>
	document.scheduleOrder
		.toArray()
		.map((id) => document.schedules.get(id) as Schedule);

/** The flow of that name as the document reads it. */
function sourceOf(document: FlowDocument, name: string) {
	const source = flowSources(document)[name];
	if (!source || !("json" in source)) throw new Error(`No flow ${name}.`);
	return source;
}

const promptOf = (document: FlowDocument, name: string) =>
	(sourceOf(document, name).json as { nodes: { prompt?: string }[] }).nodes[0]
		?.prompt;

/** The Host's Project has `triage`; the Device's has `triage` too, and `review`. */
async function seed() {
	await save(hosted, "triage", "Hosted triage", 1, HOSTED);
	await save(local, "triage", "Local triage", 2, LOCAL);
	await save(local, "triage", "Local triage, again", 3, LOCAL);
	await save(local, "review", "Local review", 4, LOCAL);
	await schedule(hosted, { id: "nightly", flow: "triage" });
	await schedule(local, { id: "nightly", flow: "triage", person: LOCAL });
	await schedule(local, { id: "weekly", flow: "review", cron: "0 8 * * 1" });
	await schedule(local, { id: "same", flow: "review" });
	await schedule(hosted, { id: "same", flow: "review" });
}

const merge = () =>
	mergeFlowDocuments(local, hosted, { persons: { [LOCAL]: HOSTED }, at: 10 });

describe("mergeFlowDocuments", () => {
	test("both keep every flow: the destination's keep their names, a source flow with a taken name gets the next free one", async () => {
		await seed();
		const plan = await merge();

		expect(plan.flows).toEqual({ triage: "triage-2" });
		expect(Object.keys(flowSources(hosted))).toEqual([
			"review",
			"triage",
			"triage-2",
		]);
		expect(promptOf(hosted, "triage")).toBe("Hosted triage");
		expect(promptOf(hosted, "triage-2")).toBe("Local triage, again");
		expect(promptOf(hosted, "review")).toBe("Local review");
		// The name is stored: it stays when the other flow goes.
		const flowId = flowIdOf(hosted, "triage-2");
		expect((hosted.flows.get(flowId ?? "") as Y.Map<unknown>).get("name")).toBe(
			"triage-2",
		);
	});

	test("each flow keeps its revisions, with the Person's id in the destination", async () => {
		await seed();
		const localId = flowIdOf(local, "triage") ?? "";
		const before = flowRevisions(local, localId);
		await merge();

		const after = flowRevisions(hosted, localId);
		expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
		expect(after.map((r) => r.personId)).toEqual([HOSTED, HOSTED]);
		const hostedId = flowIdOf(hosted, "triage") ?? "";
		expect(flowRevisions(hosted, hostedId)).toHaveLength(1);
		// The flow reads with the revision it was saved as.
		expect(sourceOf(hosted, "triage-2").revision).toBe(before.at(-1)?.id);
	});

	test("schedules follow their flow, one that the destination has is one, and a taken id gets the next free one", async () => {
		await seed();
		const plan = await merge();

		expect(plan.schedules).toEqual({ nightly: "nightly-2" });
		expect(
			schedulesOf(hosted).map(({ id, flow, person }) => ({ id, flow, person })),
		).toEqual([
			{ id: "nightly", flow: "triage", person: undefined },
			{ id: "same", flow: "review", person: undefined },
			{ id: "nightly-2", flow: "triage-2", person: HOSTED },
			{ id: "weekly", flow: "review", person: undefined },
		]);
	});

	test("a flow with the name and the content of one in the destination reads once, with both histories", async () => {
		await save(hosted, "triage", "Same triage", 1, HOSTED);
		await save(local, "triage", "Same triage", 2, LOCAL);
		const localId = flowIdOf(local, "triage") ?? "";
		const plan = await merge();

		expect(plan.flows).toEqual({});
		expect(Object.keys(flowSources(hosted))).toEqual(["triage"]);
		expect(flowIdOf(hosted, "triage")).not.toBe(localId);
		expect(flowRevisions(hosted, localId)).toHaveLength(1);
	});

	test("a preview says what the merge renames and changes nothing", async () => {
		await seed();
		const state = Y.encodeStateVector(hosted.current.doc);
		expect(planFlowMerge(local, hosted, { [LOCAL]: HOSTED })).toEqual({
			flows: { triage: "triage-2" },
			schedules: { nightly: "nightly-2" },
		});
		expect(Y.encodeStateVector(hosted.current.doc)).toEqual(state);
		expect(flowsMerged(local, hosted)).toBe(false);
	});

	test("a merge that runs again changes nothing", async () => {
		await seed();
		await merge();
		expect(flowsMerged(local, hosted)).toBe(true);
		const current = Y.encodeStateVector(hosted.current.doc);
		const history = Y.encodeStateVector(hosted.history.doc);

		expect(await merge()).toEqual({ flows: {}, schedules: {} });
		expect(Y.encodeStateVector(hosted.current.doc)).toEqual(current);
		expect(Y.encodeStateVector(hosted.history.doc)).toEqual(history);
	});

	test("a merge cut short after the history runs again to its end", async () => {
		await seed();
		// The history merged, the flows did not: what a crash between the two leaves.
		await mergeFlowDocuments(local, hosted, { at: 10 });
		hosted.meta.delete("mergedFrom:p-local");
		for (const flowId of [...hosted.flows.keys()]) {
			if (flowIdOf(local, "review") === flowId) hosted.flows.delete(flowId);
		}
		const localId = flowIdOf(local, "triage") ?? "";
		const revisions = flowRevisions(hosted, localId).length;

		await merge();
		expect(flowRevisions(hosted, localId)).toHaveLength(revisions);
		expect(Object.keys(flowSources(hosted))).toEqual([
			"review",
			"triage",
			"triage-2",
		]);
	});

	test("the merge is kept: the documents read it back from the Replica", async () => {
		await seed();
		await merge();
		await documents.close();
		documents = createFlowDocuments({ db: sandbox.db });
		const again = await documents.open("p-hosted");
		expect(Object.keys(flowSources(again))).toEqual([
			"review",
			"triage",
			"triage-2",
		]);
		expect(flowsMerged({ projectId: "p-local" }, again)).toBe(true);
	});
});
