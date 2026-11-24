import { randomUUID } from "node:crypto";
import { FLOW_VERSION, type Flow } from "@nightshift/flows";
import type * as Y from "yjs";
import type { FlowDocument } from "../../../../documents";
import {
	type FlowRevision,
	type RevisionKind,
	same,
} from "../../domain/flow-json";
import { flowNotFound, foreignFlow } from "../../domain/flow-save";
import {
	nodeWithShape,
	type OutputType,
	outputsWithTypes,
	type StepShapes,
} from "../../domain/inferred";
import {
	applyFlow,
	flowJson,
	lastRevision,
	mapsOf,
	newFlowMap,
	plain,
	scanFlows,
} from "./yjs-flow-encoding";

/**
 * The writes of the flows of a flow document, each a change of `current`
 * and then one of `history` (the revision). They change a flow of the
 * current format only. `yjs-flow-encoding.ts` has the encoding they write.
 */

/**
 * Saves a flow under its name, a draft with errors too: a new flow when
 * no flow has the name. Writes only what changed, so an edit of one node
 * merges with an edit of another. A save that changes nothing since the
 * last revision adds none. Refuses (`conflict`) to write over a flow of
 * another format.
 */
export async function saveFlow(
	document: FlowDocument,
	input: {
		name: string;
		flow: Flow;
		kind: RevisionKind;
		personId: string | null;
		deviceId: string;
		at: number;
	},
): Promise<{ flowId: string; revisionId: string | null }> {
	const maps = mapsOf(document);
	const scan = scanFlows(document);
	const found = scan.entries.find((entry) => entry.name === input.name);
	if (found && found.format !== "current") {
		throw foreignFlow(input.name, found.format);
	}
	const snapshot = { ...input.flow, version: FLOW_VERSION };
	const flowId = found?.flowId ?? randomUUID();
	const last = lastRevision(document, flowId);
	const revisionId =
		last !== undefined && same(last.flow, snapshot) ? null : randomUUID();

	await document.current.change(() => {
		if (maps.meta.get("projectId") !== document.projectId) {
			maps.meta.set("projectId", document.projectId);
		}
		const map = found?.map ?? newFlowMap(maps.flows, flowId, input.at);
		if (map.get("name") !== input.name) map.set("name", input.name);
		applyFlow(map, input.flow);
		// A copy reads again once its original changes: it goes, its revisions stay.
		for (const copy of scan.copies.get(flowId) ?? []) {
			maps.flows.delete(copy);
		}
	});
	if (revisionId !== null) {
		await document.history.change(() => {
			document.history.doc.getArray(flowId).push([
				plain({
					id: revisionId,
					at: input.at,
					personId: input.personId,
					deviceId: input.deviceId,
					kind: input.kind,
					flow: snapshot,
				} satisfies FlowRevision),
			]);
		});
	}
	return { flowId, revisionId };
}

/**
 * Keeps the shapes of a run's step on its node of the flow of that name:
 * the node's `output` becomes the shape of the field it types, marked
 * inferred (`outputInferred`), with one revision of kind `infer` by Night
 * Shift on `deviceId`. Writes only that node, so an edit of another node
 * merges with it. Writes nothing when the flow is gone or of another
 * format, or the node is gone, of another type, or has a schema already: a person's schema
 * always wins. Returns the revision's id, or null.
 */
export async function keepShapes(
	document: FlowDocument,
	input: {
		name: string;
		node: { id: string; type: string };
		shapes: StepShapes;
		deviceId: string;
		at: number;
	},
): Promise<string | null> {
	const scan = scanFlows(document);
	const found = scan.entries.find((entry) => entry.name === input.name);
	if (found?.format !== "current") return null;
	const store = found.map.get("nodes") as Y.Map<unknown>;
	const node = nodeWithShape(
		store.get(input.node.id),
		input.node.type,
		input.shapes,
	);
	if (node === null) return null;

	await document.current.change(() => {
		store.set(input.node.id, plain(node));
		// A copy reads again once its original changes: it goes, its revisions stay.
		for (const copy of scan.copies.get(found.flowId) ?? []) {
			mapsOf(document).flows.delete(copy);
		}
	});
	const revisionId = randomUUID();
	const flow = flowJson(found.map);
	await document.history.change(() => {
		document.history.doc.getArray(found.flowId).push([
			plain({
				id: revisionId,
				at: input.at,
				personId: null,
				deviceId: input.deviceId,
				kind: "infer",
				flow: { ...flow, version: FLOW_VERSION },
			} satisfies FlowRevision),
		]);
	});
	return revisionId;
}

/**
 * Keeps the types a run gave the outputs of the flow of that name: each
 * output named in `types` that has no type yet and still has the template
 * the run read gets its `type` (and `schema`), marked `inferred`, with one
 * revision of kind `infer` by Night Shift on `deviceId`. Writes nothing
 * when the flow is gone or of another format, or no output takes a type: a
 * person's type always wins. Returns the revision's id, or null.
 */
export async function keepOutputTypes(
	document: FlowDocument,
	input: {
		name: string;
		types: readonly OutputType[];
		deviceId: string;
		at: number;
	},
): Promise<string | null> {
	const scan = scanFlows(document);
	const found = scan.entries.find((entry) => entry.name === input.name);
	if (found?.format !== "current") return null;
	const scalars = found.map.get("scalars") as Y.Map<unknown>;
	const outputs = outputsWithTypes(scalars.get("outputs"), input.types);
	if (outputs === null) return null;

	await document.current.change(() => {
		scalars.set("outputs", plain(outputs));
		// A copy reads again once its original changes: it goes, its revisions stay.
		for (const copy of scan.copies.get(found.flowId) ?? []) {
			mapsOf(document).flows.delete(copy);
		}
	});
	const revisionId = randomUUID();
	const flow = flowJson(found.map);
	await document.history.change(() => {
		document.history.doc.getArray(found.flowId).push([
			plain({
				id: revisionId,
				at: input.at,
				personId: null,
				deviceId: input.deviceId,
				kind: "infer",
				flow: { ...flow, version: FLOW_VERSION },
			} satisfies FlowRevision),
		]);
	});
	return revisionId;
}

/** Removes the flow of that name. Its revisions stay. Refuses (`not-found`) a flow that does not exist. */
export async function removeFlow(
	document: FlowDocument,
	name: string,
): Promise<void> {
	const maps = mapsOf(document);
	const scan = scanFlows(document);
	const found = scan.entries.find(
		(entry) => entry.name === name && entry.format !== "newer",
	);
	if (!found) throw flowNotFound(name);
	await document.current.change(() => {
		for (const flowId of [
			found.flowId,
			...(scan.copies.get(found.flowId) ?? []),
		]) {
			maps.flows.delete(flowId);
		}
	});
}
