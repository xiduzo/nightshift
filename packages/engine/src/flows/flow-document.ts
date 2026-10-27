import { randomUUID } from "node:crypto";
import type { DocumentSpace } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import { project } from "@nightshift/db/schema";
import {
	FLOW_VERSION,
	type Flow,
	type FlowSources,
	flowNameSchema,
	parsedFlows,
	parseFlow,
	type Schedule,
	type ScheduleIssue,
	scheduleFlowInfos,
	scheduleSchema,
	suffixedName,
	validateSchedules,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { eq } from "drizzle-orm";
import * as Y from "yjs";
import { z } from "zod";
import {
	openPersistedDocument,
	type PersistedDocument,
} from "../device-config";
import { spaceIdOf } from "../projects";
import type { ProjectFlows } from "./project-flows";

/**
 * The flow document: the flows and the schedules of one Project as Night
 * Shift data (ADR 2), in two Yjs documents that the Replica keeps in its
 * `ydoc` table.
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
 * - `meta`: the Project's id, and later the import markers.
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
 */
export type FlowDocument = {
	readonly projectId: string;
	/** `flows:<projectId>`: the current flows and schedules. */
	readonly current: PersistedDocument;
	/** `flows-history:<projectId>`: the revisions. */
	readonly history: PersistedDocument;
	readonly flows: Y.Map<unknown>;
	readonly schedules: Y.Map<unknown>;
	readonly scheduleOrder: Y.Array<string>;
	readonly notices: Y.Map<unknown>;
	readonly meta: Y.Map<unknown>;
};

/** The name of a Project's flow document. */
export function flowDocumentName(projectId: string): string {
	return `flows:${projectId}`;
}

/** The name of a Project's flow history document. */
export function flowHistoryName(projectId: string): string {
	return `flows-history:${projectId}`;
}

/** The Project of a flow document or a flow history name, or null for another kind. */
export function flowDocumentProject(name: string): string | null {
	for (const prefix of ["flows:", "flows-history:"]) {
		if (name.startsWith(prefix)) return name.slice(prefix.length) || null;
	}
	return null;
}

/**
 * The Space of a synced document, for the relay's access check: a Space
 * document, or a flow document of a Project this Replica has. Null for
 * another kind, and for a Project it does not have.
 */
export function documentSpace(
	db: Database,
): (name: string) => Promise<DocumentSpace | null> {
	return async (name) => {
		const spaceId = spaceIdOf(name);
		if (spaceId !== null) return { spaceId, kind: "space" };
		const projectId = flowDocumentProject(name);
		if (projectId === null) return null;
		const [row] = await db
			.select({ spaceId: project.spaceId })
			.from(project)
			.where(eq(project.id, projectId));
		return row ? { spaceId: row.spaceId, kind: "flows" } : null;
	};
}

/** The transaction origin of this Replica's own changes. */
export const FLOW_ORIGIN = Symbol("flow-document-owner");

/** Why a revision exists. */
export const revisionKinds = [
	"save",
	"restore",
	"import",
	"merge",
	"copy",
] as const;
export type RevisionKind = (typeof revisionKinds)[number];

const flowRevisionSchema = z.object({
	id: z.string(),
	at: z.number(),
	personId: z.string().nullable(),
	deviceId: z.string(),
	kind: z.enum(revisionKinds),
	flow: z.looseObject({ version: z.number() }),
});
/** One save of a flow: who, when, on which Device, why, and the whole flow. */
export type FlowRevision = z.infer<typeof flowRevisionSchema>;

/** The top-level fields of a flow that are not scalars, and the order the others read in. */
const STRUCTURE = new Set(["version", "nodes", "edges", "sections"]);
const SCALAR_ORDER = [
	"description",
	"inputs",
	"outputs",
	"variables",
	"policy",
	"start",
];

/** A flow of the document as a read sees it. */
type FlowEntry = {
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
function flowEntries(document: FlowDocument): FlowEntry[] {
	return scanFlows(document).entries;
}

/**
 * The flows of the document, and the copies it leaves out: a flow with
 * the name and the content of an older one, as two Devices that import
 * the same Clone folder before they sync leave it. The older reads, the
 * copy does not (`copies`: by the flow id of the one that reads).
 */
function scanFlows(document: FlowDocument): {
	entries: FlowEntry[];
	copies: Map<string, string[]>;
} {
	const all: Omit<FlowEntry, "name">[] = [];
	for (const [flowId, value] of document.flows.entries()) {
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
function flowJson(map: Y.Map<unknown>): Record<string, unknown> {
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
	const scan = scanFlows(document);
	const found = scan.entries.find((entry) => entry.name === input.name);
	if (found?.newer) {
		throw new Refusal(
			"conflict",
			`A newer version of Night Shift saved the flow "${input.name}". Update Night Shift to change it.`,
		);
	}
	const snapshot = { ...input.flow, version: FLOW_VERSION };
	const flowId = found?.flowId ?? randomUUID();
	const last = flowRevisions(document, flowId).at(-1);
	const revisionId =
		last !== undefined && same(last.flow, snapshot) ? null : randomUUID();

	await document.current.change(() => {
		if (document.meta.get("projectId") !== document.projectId) {
			document.meta.set("projectId", document.projectId);
		}
		const map = found?.map ?? newFlowMap(document.flows, flowId, input.at);
		if (map.get("name") !== input.name) map.set("name", input.name);
		applyFlow(map, input.flow);
		// A copy reads again once its original changes: it goes, its revisions stay.
		for (const copy of scan.copies.get(flowId) ?? []) {
			document.flows.delete(copy);
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

/** Removes the flow of that name. Its revisions stay. Refuses (`not-found`) a flow that does not exist. */
export async function removeFlow(
	document: FlowDocument,
	name: string,
): Promise<void> {
	const scan = scanFlows(document);
	const found = scan.entries.find(
		(entry) => entry.name === name && !entry.newer,
	);
	if (!found) {
		throw new Refusal("not-found", `The flow "${name}" does not exist.`);
	}
	await document.current.change(() => {
		for (const flowId of [
			found.flowId,
			...(scan.copies.get(found.flowId) ?? []),
		]) {
			document.flows.delete(flowId);
		}
	});
}

/** The revisions of a flow that this Night Shift reads, oldest first. One from a newer Night Shift is left out. */
export function flowRevisions(
	document: FlowDocument,
	flowId: string,
): FlowRevision[] {
	const revisions: FlowRevision[] = [];
	for (const value of document.history.doc.getArray(flowId).toArray()) {
		const parsed = flowRevisionSchema.safeParse(value);
		if (parsed.success && parsed.data.flow.version <= FLOW_VERSION) {
			revisions.push(parsed.data);
		}
	}
	return revisions;
}

/** The id of the flow of that name, or null. */
export function flowIdOf(document: FlowDocument, name: string): string | null {
	return (
		flowEntries(document).find((entry) => entry.name === name)?.flowId ?? null
	);
}

function newFlowMap(
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
function applyFlow(map: Y.Map<unknown>, flow: Flow): void {
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
function keyedById<T extends { id: string }>(
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
function applyOrder(order: Y.Array<string>, wanted: readonly string[]): void {
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

/** The schedules of the document that this Night Shift reads, in their order, and whether it holds others. */
export function readSchedules(document: FlowDocument): {
	schedules: Schedule[];
	unreadable: number;
} {
	const schedules: Schedule[] = [];
	let unreadable = 0;
	for (const key of orderedKeys(document.schedules, document.scheduleOrder)) {
		const parsed = scheduleSchema.safeParse(document.schedules.get(key));
		if (parsed.success) schedules.push(parsed.data);
		else unreadable++;
	}
	return { schedules, unreadable };
}

function orderedKeys(store: Y.Map<unknown>, order: Y.Array<string>): string[] {
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

/** Saves the schedules: only those that differ. One that this Night Shift does not read stays. */
export async function saveSchedules(
	document: FlowDocument,
	schedules: readonly Schedule[],
): Promise<void> {
	await document.current.change(() => {
		const keyed = keyedById(schedules);
		const wanted = new Map(keyed);
		const kept: string[] = [];
		for (const key of orderedKeys(document.schedules, document.scheduleOrder)) {
			if (wanted.has(key)) continue;
			if (scheduleSchema.safeParse(document.schedules.get(key)).success) {
				document.schedules.delete(key);
			} else {
				kept.push(key);
			}
		}
		for (const [key, schedule] of keyed) {
			if (!same(document.schedules.get(key), schedule)) {
				document.schedules.set(key, plain(schedule));
			}
		}
		applyOrder(document.scheduleOrder, [...keyed.map(([key]) => key), ...kept]);
	});
}

/** The same JSON, whatever the order of the keys. */
export function same(a: unknown, b: unknown): boolean {
	return stableJson(a) === stableJson(b);
}

function stableJson(value: unknown): string {
	return JSON.stringify(value, (_key, inner: unknown) =>
		inner !== null && typeof inner === "object" && !Array.isArray(inner)
			? Object.fromEntries(
					Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : 1)),
				)
			: inner,
	);
}

/** As JSON: without `undefined` fields, and shared with nothing. */
function plain<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

/** The flow documents this Replica holds, opened once each. */
export type FlowDocuments = {
	/** The Project's flow document and its history. */
	open(projectId: string): Promise<FlowDocument>;
	/** Opens the documents of every Project this Replica knows. */
	openAll(): Promise<FlowDocument[]>;
	/** An open document by its name (`flows:<id>`, `flows-history:<id>`). */
	byName(name: string): PersistedDocument | null;
	/**
	 * A document by its name, for the relay: opened when its Project is
	 * one this Replica has. Null for another name.
	 */
	find(name: string): Promise<PersistedDocument | null>;
	/** Flushes every document. */
	flush(): Promise<void>;
	close(): Promise<void>;
};

export function createFlowDocuments(options: { db: Database }): FlowDocuments {
	const { db } = options;
	const opening = new Map<string, Promise<FlowDocument>>();
	const opened = new Map<string, PersistedDocument>();

	async function openOne(projectId: string): Promise<FlowDocument> {
		const [current, history] = await Promise.all([
			openPersistedDocument({
				db,
				name: flowDocumentName(projectId),
				origin: FLOW_ORIGIN,
				label: "The flow document",
			}),
			openPersistedDocument({
				db,
				name: flowHistoryName(projectId),
				origin: FLOW_ORIGIN,
				label: "The flow history",
			}),
		]);
		opened.set(current.name, current);
		opened.set(history.name, history);
		const { doc } = current;
		return {
			projectId,
			current,
			history,
			flows: doc.getMap("flows"),
			schedules: doc.getMap("schedules"),
			scheduleOrder: doc.getArray("scheduleOrder"),
			notices: doc.getMap("notices"),
			meta: doc.getMap("meta"),
		};
	}

	function open(projectId: string): Promise<FlowDocument> {
		let found = opening.get(projectId);
		if (!found) {
			found = openOne(projectId);
			opening.set(projectId, found);
			found.catch(() => opening.delete(projectId));
		}
		return found;
	}

	return {
		open,
		async openAll() {
			const rows = await db.select({ id: project.id }).from(project);
			return Promise.all(rows.map((row) => open(row.id)));
		},
		byName: (name) => opened.get(name) ?? null,
		async find(name) {
			const known = opened.get(name);
			if (known) return known;
			const projectId = flowDocumentProject(name);
			if (projectId === null) return null;
			const [row] = await db
				.select({ id: project.id })
				.from(project)
				.where(eq(project.id, projectId));
			if (!row) return null;
			await open(projectId);
			return opened.get(name) ?? null;
		},
		async flush() {
			await Promise.all([...opened.values()].map((d) => d.flush()));
		},
		async close() {
			await Promise.all([...opened.values()].map((d) => d.close()));
			opened.clear();
			opening.clear();
		},
	};
}

export type DocumentProjectFlowsDeps = {
	documents: Pick<FlowDocuments, "open">;
	/** The project, in the Space when one is given. Throws when it is not there. */
	find(projectId: string, spaceId?: string): Promise<unknown>;
	/** This Device: where a save happens. */
	deviceId: string | (() => Promise<string>);
	/** The clock of a revision. Default `Date.now`. */
	now?: () => number;
};

/**
 * The flows and schedules of a project in its flow document. Every
 * Device reads and saves them, with or without a Clone of the project.
 * A save records a revision of kind `save`, or the kind it names.
 */
export function documentProjectFlows(
	deps: DocumentProjectFlowsDeps,
): ProjectFlows {
	const now = deps.now ?? Date.now;
	const documentOf = async (projectId: string, spaceId?: string) => {
		await deps.find(projectId, spaceId);
		return deps.documents.open(projectId);
	};

	return {
		async flows({ projectId, spaceId }) {
			const document = await documentOf(projectId, spaceId);
			return { sources: flowSources(document), pathOf: (name) => name };
		},

		async save({ projectId, spaceId, personId }, name, flow, options = {}) {
			const valid = flowNameSchema.safeParse(name);
			if (!valid.success) {
				throw new Refusal(
					"invalid",
					`The flow name "${name}" is not valid. ${valid.error.issues[0]?.message ?? "Pick another name."}`,
				);
			}
			const document = await documentOf(projectId, spaceId);
			await saveFlow(document, {
				name,
				flow,
				kind: options.kind ?? "save",
				personId: personId ?? null,
				deviceId:
					typeof deps.deviceId === "string"
						? deps.deviceId
						: await deps.deviceId(),
				at: now(),
			});
			const current: Flow = { ...flow, version: FLOW_VERSION };
			return parseFlow(current, {
				flows: parsedFlows(flowSources(document)),
				name,
			}).issues;
		},

		async remove({ projectId, spaceId }, name) {
			await removeFlow(await documentOf(projectId, spaceId), name);
		},

		async revisions({ projectId, spaceId }, name) {
			const document = await documentOf(projectId, spaceId);
			const flowId = flowIdOf(document, name);
			return flowId === null ? [] : flowRevisions(document, flowId);
		},

		async schedules({ projectId, spaceId }, options = {}) {
			const document = await documentOf(projectId, spaceId);
			const { schedules, unreadable } = readSchedules(document);
			const issues: ScheduleIssue[] =
				unreadable > 0
					? [
							{
								severity: "warning",
								message:
									"A newer version of Night Shift saved some schedules. Update Night Shift to see them.",
							},
						]
					: [];
			if (options.validate !== false) {
				issues.push(
					...validateSchedules(
						schedules,
						scheduleFlowInfos(flowSources(document)),
					),
				);
			}
			return { path: "schedules", schedules, issues };
		},

		async saveSchedules({ projectId, spaceId }, schedules) {
			const document = await documentOf(projectId, spaceId);
			await saveSchedules(document, schedules);
			return validateSchedules(
				schedules,
				scheduleFlowInfos(flowSources(document)),
			);
		},
	};
}
