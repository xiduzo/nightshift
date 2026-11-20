import {
	FLOW_VERSION,
	type Flow,
	type FlowSources,
	flowNameSchema,
	suffixedName,
} from "@nightshift/flows";
import * as Y from "yjs";
import type { FlowDocument } from "../../../../documents";
import {
	type FlowRevision,
	readableRevision,
	same,
	stableJson,
} from "../../domain/flow-json";

/**
 * The Yjs encoding of the flow document: the flows and the schedules of
 * one Project as Night Shift data (ADR 2), in two Yjs documents that the
 * Replica keeps in its `ydoc` table.
 *
 * `flows:<projectId>` holds the current state:
 * - `flows`: flow id → Y.Map `{ name, createdAt, version, hasSections,
 *   scalars, nodes, edges, sections, nodeOrder, edgeOrder, sectionOrder }`.
 *   `scalars` holds every other top-level field of the flow as JSON.
 *   `nodes`, `edges` and `sections` are keyed by id, so two edits of
 *   different nodes merge and two edits of one node keep one of them. The
 *   order arrays keep the order of the flow's lists.
 * - `schedules`: schedule id → its JSON, and `scheduleOrder`.
 * - `notices`: what a person must know about the flows (the import).
 * - `meta`: the Project's id, the import markers, and `schedulesVersion`:
 *   the format of the schedules (`SCHEDULES_VERSION`), 1 when it is unset.
 *
 * `flows-history:<projectId>` holds the revisions: one root array per flow
 * id, oldest first. A root array, not a map entry, so two Replicas that
 * add the first revision of a flow at the same time keep both.
 *
 * A flow is keyed by its id, and its name is a field. Two flows with one
 * name (two Devices that created it offline) both stay: the older keeps
 * the name, the newer reads with a suffix (`suffixedName`) until a save
 * writes that name. A newer one with the same content too (two Devices
 * that imported one Clone folder) does not read at all, and a save of
 * the older removes it.
 *
 * The files `yjs-*.ts` of this folder are the only ones that know the Yjs
 * encoding. Outside them a flow document is the pair of documents a Link
 * syncs (`FlowDocument`, in `documents/`), and the engine reads and
 * changes the flows through the `FlowStore` port (`yjs-flow-store.ts`).
 */

/** The flow document with the parts of `current` that hold the flows: only the Yjs adapter's. */
export type FlowMaps = FlowDocument & {
	readonly flows: Y.Map<unknown>;
	readonly schedules: Y.Map<unknown>;
	readonly scheduleOrder: Y.Array<string>;
	readonly notices: Y.Map<unknown>;
	readonly meta: Y.Map<unknown>;
};

/** The parts of the flow document. A Y.Doc gives the same shared type for a name each time. */
export function mapsOf(document: FlowDocument): FlowMaps {
	const { doc } = document.current;
	return {
		...document,
		flows: doc.getMap("flows"),
		schedules: doc.getMap("schedules"),
		scheduleOrder: doc.getArray("scheduleOrder"),
		notices: doc.getMap("notices"),
		meta: doc.getMap("meta"),
	};
}

/** The top-level fields of a flow that are not scalars, and the order the others read in. */
const STRUCTURE = new Set(["version", "nodes", "edges", "sections"]);
const SCALAR_ORDER = [
	"description",
	"inputs",
	"outputs",
	"variables",
	"policy",
	"devices",
	"start",
];

/** A flow of the document as a read sees it. */
export type FlowEntry = {
	flowId: string;
	/** Its name for this read: the stored one, or with a suffix on a clash. */
	name: string;
	stored: string;
	createdAt: number;
	/** A newer Night Shift saved it: this one does not read or change it. */
	newer: boolean;
	map: Y.Map<unknown>;
};

/** Every flow of the document that has a valid name, each with a name of its own. */
export function flowEntries(document: FlowDocument): FlowEntry[] {
	return scanFlows(document).entries;
}

/**
 * The flows of the document, and the copies it leaves out: a flow with
 * the name and the content of an older one, as two Devices that import
 * the same Clone folder before they sync leave it. The older reads, the
 * copy does not (`copies`: by the flow id of the one that reads).
 */
export function scanFlows(document: FlowDocument): {
	entries: FlowEntry[];
	copies: Map<string, string[]>;
} {
	const maps = mapsOf(document);
	const all: Omit<FlowEntry, "name">[] = [];
	for (const [flowId, value] of maps.flows.entries()) {
		if (!(value instanceof Y.Map)) continue;
		const map = value as Y.Map<unknown>;
		const stored = map.get("name");
		const version = map.get("version");
		const createdAt = map.get("createdAt");
		if (typeof stored !== "string" || !flowNameSchema.safeParse(stored).success)
			continue;
		if (typeof version !== "number" || typeof createdAt !== "number") continue;
		const newer = version > FLOW_VERSION;
		if (!newer && !readable(map)) continue;
		all.push({ flowId, stored, createdAt, newer, map });
	}
	all.sort((a, b) =>
		a.createdAt !== b.createdAt
			? a.createdAt - b.createdAt
			: a.flowId < b.flowId
				? -1
				: 1,
	);
	const copies = new Map<string, string[]>();
	const counts = new Map<string, number>();
	for (const entry of all) {
		counts.set(entry.stored, (counts.get(entry.stored) ?? 0) + 1);
	}
	const seen: { entry: Omit<FlowEntry, "name">; json: string }[] = [];
	const entries = all.filter((entry) => {
		if (entry.newer || (counts.get(entry.stored) ?? 0) < 2) return true;
		const json = stableJson(flowJson(entry.map));
		const original = seen.find(
			(other) => other.entry.stored === entry.stored && other.json === json,
		);
		if (!original) {
			seen.push({ entry, json });
			return true;
		}
		const flowId = original.entry.flowId;
		copies.set(flowId, [...(copies.get(flowId) ?? []), entry.flowId]);
		return false;
	});
	const taken = new Set(entries.map((entry) => entry.stored));
	const owners = new Set<string>();
	return {
		copies,
		entries: entries.map((entry) => {
			if (!owners.has(entry.stored)) {
				owners.add(entry.stored);
				return { ...entry, name: entry.stored };
			}
			const name = suffixedName(entry.stored, taken);
			taken.add(name);
			return { ...entry, name };
		}),
	};
}

function readable(map: Y.Map<unknown>): boolean {
	return (
		["scalars", "nodes", "edges", "sections"].every(
			(key) => map.get(key) instanceof Y.Map,
		) &&
		["nodeOrder", "edgeOrder", "sectionOrder"].every(
			(key) => map.get(key) instanceof Y.Array,
		)
	);
}

/**
 * Every flow of the document that this Night Shift reads, by name: what a
 * Clone's flow files were. Each with its Flow revision, when the flow is
 * the last one saved.
 */
export function flowSources(document: FlowDocument): FlowSources {
	const sources: FlowSources = {};
	for (const entry of flowEntries(document).sort((a, b) =>
		a.name < b.name ? -1 : 1,
	)) {
		if (entry.newer) continue;
		const json = flowJson(entry.map);
		const last = flowRevisions(document, entry.flowId).at(-1);
		// A merge that no revision records yet is no revision.
		sources[entry.name] =
			last !== undefined && same(last.flow, json)
				? { json, revision: last.id }
				: { json };
	}
	return sources;
}

/** The flow a Y.Map holds, as JSON. */
export function flowJson(map: Y.Map<unknown>): Record<string, unknown> {
	const scalars = map.get("scalars") as Y.Map<unknown>;
	const json: Record<string, unknown> = { version: map.get("version") };
	const keys = [
		...SCALAR_ORDER.filter((key) => scalars.has(key)),
		...[...scalars.keys()].filter((key) => !SCALAR_ORDER.includes(key)).sort(),
	];
	for (const key of keys) json[key] = structuredClone(scalars.get(key));
	json.nodes = orderedItems(map, "nodes", "nodeOrder");
	json.edges = orderedItems(map, "edges", "edgeOrder");
	if (map.get("hasSections") === true) {
		json.sections = orderedItems(map, "sections", "sectionOrder");
	}
	return json;
}

function orderedItems(
	map: Y.Map<unknown>,
	itemsKey: string,
	orderKey: string,
): unknown[] {
	const store = map.get(itemsKey) as Y.Map<unknown>;
	const order = map.get(orderKey) as Y.Array<string>;
	const seen = new Set<string>();
	const items: unknown[] = [];
	for (const key of order.toArray()) {
		if (seen.has(key) || !store.has(key)) continue;
		seen.add(key);
		items.push(structuredClone(store.get(key)));
	}
	for (const key of [...store.keys()].sort()) {
		if (!seen.has(key)) items.push(structuredClone(store.get(key)));
	}
	return items;
}

/** The newest revision of a flow that this Night Shift reads, or none. Older ones stay for the history. */
export function lastRevision(
	document: FlowDocument,
	flowId: string,
): FlowRevision | undefined {
	const list = document.history.doc.getArray(flowId);
	for (let index = list.length - 1; index >= 0; index--) {
		const revision = readableRevision(list.get(index));
		if (revision !== null) return revision;
	}
	return undefined;
}

/** The revisions of a flow that this Night Shift reads, oldest first. One from a newer Night Shift is left out. */
export function flowRevisions(
	document: FlowDocument,
	flowId: string,
): FlowRevision[] {
	const revisions: FlowRevision[] = [];
	for (const value of document.history.doc.getArray(flowId).toArray()) {
		const revision = readableRevision(value);
		if (revision !== null) revisions.push(revision);
	}
	return revisions;
}

/** The id of the flow of that name, or null. */
export function flowIdOf(document: FlowDocument, name: string): string | null {
	return (
		flowEntries(document).find((entry) => entry.name === name)?.flowId ?? null
	);
}

export function newFlowMap(
	flows: Y.Map<unknown>,
	flowId: string,
	at: number,
): Y.Map<unknown> {
	const map = new Y.Map<unknown>();
	flows.set(flowId, map);
	map.set("createdAt", at);
	map.set("version", FLOW_VERSION);
	map.set("hasSections", false);
	for (const key of ["scalars", "nodes", "edges", "sections"]) {
		map.set(key, new Y.Map());
	}
	for (const key of ["nodeOrder", "edgeOrder", "sectionOrder"]) {
		map.set(key, new Y.Array());
	}
	return map;
}

/** Writes the flow into its Y.Map: only the fields, nodes, edges and Sections that differ. */
export function applyFlow(map: Y.Map<unknown>, flow: Flow): void {
	if (map.get("version") !== FLOW_VERSION) map.set("version", FLOW_VERSION);
	const scalars = map.get("scalars") as Y.Map<unknown>;
	const wanted = new Map(
		Object.entries(flow).filter(
			([key, value]) => !STRUCTURE.has(key) && value !== undefined,
		),
	);
	for (const key of [...scalars.keys()]) {
		if (!wanted.has(key)) scalars.delete(key);
	}
	for (const [key, value] of wanted) {
		if (!same(scalars.get(key), value)) scalars.set(key, plain(value));
	}
	applyItems(map, "nodes", "nodeOrder", flow.nodes);
	applyItems(map, "edges", "edgeOrder", flow.edges);
	const hasSections = flow.sections !== undefined;
	if (map.get("hasSections") !== hasSections) {
		map.set("hasSections", hasSections);
	}
	applyItems(map, "sections", "sectionOrder", flow.sections ?? []);
}

function applyItems(
	map: Y.Map<unknown>,
	itemsKey: string,
	orderKey: string,
	items: readonly { id: string }[],
): void {
	const store = map.get(itemsKey) as Y.Map<unknown>;
	const keyed = keyedById(items);
	const wanted = new Map(keyed);
	for (const key of [...store.keys()]) {
		if (!wanted.has(key)) store.delete(key);
	}
	for (const [key, item] of keyed) {
		if (!same(store.get(key), item)) store.set(key, plain(item));
	}
	applyOrder(
		map.get(orderKey) as Y.Array<string>,
		keyed.map(([key]) => key),
	);
}

/** Each item by its id. A repeated id (a draft) gets `#2`, `#3`, … so no item is lost. */
export function keyedById<T extends { id: string }>(
	items: readonly T[],
): [string, T][] {
	const seen = new Map<string, number>();
	return items.map((item) => {
		const count = (seen.get(item.id) ?? 0) + 1;
		seen.set(item.id, count);
		return [count === 1 ? item.id : `${item.id}#${count}`, item];
	});
}

/**
 * Brings an order array to `wanted` with few edits: it deletes the keys
 * that went and inserts the new ones in place. Only a changed order of the
 * keys that stay writes the whole array again.
 */
export function applyOrder(
	order: Y.Array<string>,
	wanted: readonly string[],
): void {
	const keep = new Set(wanted);
	const seen = new Set<string>();
	const current = order.toArray();
	for (let index = current.length - 1; index >= 0; index--) {
		const key = current[index] as string;
		const repeated = current.indexOf(key) !== index;
		if (!keep.has(key) || repeated) order.delete(index, 1);
	}
	const rest = order.toArray();
	for (const key of rest) seen.add(key);
	const sameOrder = wanted
		.filter((key) => seen.has(key))
		.every((key, index) => rest[index] === key);
	if (!sameOrder) {
		order.delete(0, order.length);
		order.insert(0, [...wanted]);
		return;
	}
	let position = 0;
	for (const key of wanted) {
		if (rest[position] === key) {
			position++;
			continue;
		}
		order.insert(position, [key]);
		rest.splice(position, 0, key);
		position++;
	}
}

/** The keys of `store` in `order`, then the others by key. */
export function orderedKeys(
	store: Y.Map<unknown>,
	order: Y.Array<string>,
): string[] {
	const seen = new Set<string>();
	const keys: string[] = [];
	for (const key of order.toArray()) {
		if (seen.has(key) || !store.has(key)) continue;
		seen.add(key);
		keys.push(key);
	}
	for (const key of [...store.keys()].sort()) {
		if (!seen.has(key)) keys.push(key);
	}
	return keys;
}

/** As JSON: without `undefined` fields, and shared with nothing. */
export function plain<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

/** A copy of a value of a Yjs document, its shared types new ones, for another document. */
export function copyOf(value: unknown): unknown {
	if (value instanceof Y.Map) {
		const map = new Y.Map<unknown>();
		for (const [key, inner] of value.entries()) map.set(key, copyOf(inner));
		return map;
	}
	if (value instanceof Y.Array) {
		const array = new Y.Array<unknown>();
		array.push(value.toArray().map(copyOf));
		return array;
	}
	return value === undefined ? undefined : structuredClone(value);
}
