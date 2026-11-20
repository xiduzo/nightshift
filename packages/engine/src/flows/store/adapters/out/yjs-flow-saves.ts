import { randomUUID } from "node:crypto";
import {
	FLOW_VERSION,
	type Flow,
	type FlowMigration,
	type FlowSources,
	flowSchema,
	migrateFlow,
} from "@nightshift/flows";
import type * as Y from "yjs";
import type { FlowDocument } from "../../../../documents";
import type { FlowMigrations, MigrationScope } from "../../../flow-migration";
import {
	type FlowRevision,
	olderFormat,
	type RevisionKind,
	same,
} from "../../domain/flow-json";
import { flowNotFound, newerFlow } from "../../domain/flow-save";
import {
	nodeWithShape,
	type OutputType,
	outputsWithTypes,
	type StepShapes,
} from "../../domain/inferred";
import {
	applyFlow,
	type FlowEntry,
	flowEntries,
	flowJson,
	flowRevisions,
	flowSources,
	lastRevision,
	mapsOf,
	newFlowMap,
	plain,
	scanFlows,
} from "./yjs-flow-encoding";

/**
 * The writes of the flows of a flow document, each a change of `current`
 * and then one of `history` (the revision), and the reads that bring a
 * flow of an older format to the current one. `yjs-flow-encoding.ts` has
 * the encoding they write.
 */

/**
 * The Device a flow of an older format took its profiles from: the one
 * that saved its last revision, else this one (`fallback`). With the
 * Person who saved it, whose Devices a Device name means first.
 */
function savedOn(
	document: FlowDocument,
	flowId: string,
	fallback: string,
): { deviceId: string; personId: string | null } {
	const last = flowRevisions(document, flowId).at(-1);
	return {
		deviceId: last?.deviceId ?? fallback,
		personId: last?.personId ?? null,
	};
}

/**
 * The migration of one flow of an older format: by the Device that saved
 * it, in the Space of `spaceId`, for the Person who saved it.
 */
function migrationOf(
	document: FlowDocument,
	migrations: FlowMigrations,
	flowId: string | undefined,
	deviceId: string,
	spaceId: string | undefined,
): Promise<FlowMigration> {
	const saved =
		flowId === undefined
			? { deviceId, personId: null }
			: savedOn(document, flowId, deviceId);
	const scope: MigrationScope | undefined =
		spaceId === undefined ? undefined : { spaceId, personId: saved.personId };
	return migrations.forDevice(saved.deviceId, scope);
}

/**
 * `flowSources`, with each flow of an older format brought to the current
 * one by the Device that saved it (`FlowMigrations`): its nodes name a
 * Device's profile, and their Device, by id. `spaceId`: the Space of the
 * Project, whose Devices a name means. Without `migrations`, as
 * `flowSources` reads them, and a Device name is to choose again.
 */
export async function upgradedSources(
	document: FlowDocument,
	migrations: FlowMigrations | undefined,
	deviceId: string,
	spaceId?: string,
): Promise<FlowSources> {
	const sources = flowSources(document);
	if (!migrations) return sources;
	const ids = new Map(
		flowEntries(document).map((entry) => [entry.name, entry.flowId]),
	);
	for (const [name, source] of Object.entries(sources)) {
		if (!("json" in source) || !olderFormat(source.json)) continue;
		const migration = await migrationOf(
			document,
			migrations,
			ids.get(name),
			deviceId,
			spaceId,
		);
		sources[name] = { ...source, json: migrateFlow(source.json, migration) };
	}
	return sources;
}

/**
 * Brings every flow of the document of an older format to the current one
 * (ADR 3: a node names a Device's profile, ADR 14: and its Device by id,
 * `FlowMigrations`), each with a revision of kind `upgrade` by Night Shift
 * on `deviceId`. A node whose profile or Device it cannot find keeps the
 * name, and the editor asks to pick it again. Returns the names of the
 * flows it brought up.
 *
 * Once per document: a flow of the current format does not change again.
 * The Replica that keeps the Project's Space runs it. Two Replicas that run
 * it at once read the same revisions and Device documents, so they write
 * the same nodes: what one writes, the other writes too.
 */
export async function upgradeFlows(
	document: FlowDocument,
	input: {
		migrations: FlowMigrations;
		deviceId: string;
		/** The Space of the Project, whose Devices a name means. */
		spaceId?: string;
		at: number;
	},
): Promise<string[]> {
	const upgrades: { entry: FlowEntry; flow: Flow; revisionId: string }[] = [];
	for (const entry of flowEntries(document)) {
		if (entry.newer || entry.map.get("version") === FLOW_VERSION) continue;
		const migration = await migrationOf(
			document,
			input.migrations,
			entry.flowId,
			input.deviceId,
			input.spaceId,
		);
		const parsed = flowSchema.safeParse(
			migrateFlow(flowJson(entry.map), migration),
		);
		// A flow this version cannot read stays as it is, and reads as before.
		if (!parsed.success) continue;
		upgrades.push({ entry, flow: parsed.data, revisionId: randomUUID() });
	}
	if (upgrades.length === 0) return [];
	await document.current.change(() => {
		for (const { entry, flow } of upgrades) applyFlow(entry.map, flow);
	});
	await document.history.change(() => {
		for (const { entry, flow, revisionId } of upgrades) {
			document.history.doc.getArray(entry.flowId).push([
				plain({
					id: revisionId,
					at: input.at,
					personId: null,
					deviceId: input.deviceId,
					kind: "upgrade",
					flow: { ...flow, version: FLOW_VERSION },
				} satisfies FlowRevision),
			]);
		}
	});
	return upgrades.map(({ entry }) => entry.name);
}

/**
 * Saves a flow under its name, a draft with errors too: a new flow when
 * no flow has the name. Writes only what changed, so an edit of one node
 * merges with an edit of another. A save that changes nothing since the
 * last revision adds none. Refuses (`conflict`) a flow that a newer Night
 * Shift saved.
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
	if (found?.newer) throw newerFlow(input.name);
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
 * merges with it. Writes nothing when the flow is gone, of another format
 * (a newer Night Shift saved it, or it waits for its upgrade), or the node
 * is gone, of another type, or has a schema already: a person's schema
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
	if (!found || found.newer || found.map.get("version") !== FLOW_VERSION) {
		return null;
	}
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
	if (!found || found.newer || found.map.get("version") !== FLOW_VERSION) {
		return null;
	}
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
		(entry) => entry.name === name && !entry.newer,
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
