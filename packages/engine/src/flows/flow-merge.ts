import { type FlowSource, suffixedName } from "@nightshift/flows";
import * as Y from "yjs";
import {
	type FlowDocument,
	flowEntries,
	flowSources,
	orderedKeys,
	same,
} from "./flow-document";

/**
 * Merges the flow document of one Project into the flow document of
 * another: what a Project that maps onto a Project of another Space
 * (`spaceMoveBatch`) does with its flows and schedules. Both keep every
 * flow and every revision.
 *
 * - The flows of the destination keep their names. A flow of the source
 *   with the name and the content of a flow there keeps its name: a read
 *   takes the older of the two. Another flow of the source whose name the
 *   destination has takes the next free name
 *   (`suffixedName`: `triage-2`), and keeps it: the name is stored, so it
 *   does not change when the other flow goes. Its schedules follow it.
 * - Each flow keeps its id, and with it its revisions: the history of
 *   each flow of the source joins the destination's history.
 * - A schedule of the source that the destination has as it is, is one
 *   schedule. One with the id of another schedule there takes the next
 *   free id.
 * - `persons` gives a Person of the source their id in the destination:
 *   a schedule's Person and a revision's Person take it.
 *
 * A merge that runs again changes nothing: a revision that the
 * destination has stays one, and the flows and schedules of a source
 * that merged into the destination before are not added again.
 */

/** What a merge renames, by the name a read of the source gives. */
export type FlowMergePlan = {
	/** A flow of the source: the name it takes in the destination. */
	flows: Record<string, string>;
	/** A schedule of the source: the id it takes in the destination. */
	schedules: Record<string, string>;
};

/** The key in `meta` that says the source merged into this document. */
const mergedKey = (projectId: string) => `mergedFrom:${projectId}`;

/** Whether the source's flows and schedules merged into the destination already. */
export function flowsMerged(
	source: Pick<FlowDocument, "projectId">,
	destination: FlowDocument,
): boolean {
	return destination.meta.has(mergedKey(source.projectId));
}

/**
 * The names the source's flows and the ids its schedules take in the
 * destination, only those that change. Changes nothing: what a preview
 * of the merge shows.
 */
export function planFlowMerge(
	source: FlowDocument,
	destination: FlowDocument,
	persons: Readonly<Record<string, string>> = {},
): FlowMergePlan {
	const plan: FlowMergePlan = { flows: {}, schedules: {} };
	if (flowsMerged(source, destination)) return plan;
	const taken = new Set(
		flowEntries(destination).flatMap((entry) => [entry.name, entry.stored]),
	);
	const theirs = flowSources(destination);
	const ours = flowSources(source);
	for (const entry of flowEntries(source)) {
		if (destination.flows.has(entry.flowId)) continue;
		// The same flow on both sides keeps its name: a read takes the older.
		if (sameFlow(ours[entry.name], theirs[entry.name])) continue;
		const name = suffixedName(entry.name, taken);
		taken.add(name);
		if (name !== entry.name) plan.flows[entry.name] = name;
	}
	const ids = new Set(destination.schedules.keys());
	for (const key of orderedKeys(source.schedules, source.scheduleOrder)) {
		const schedule = scheduleOf(source, key, plan.flows, persons);
		const there = destination.schedules.get(key);
		if (there === undefined) {
			ids.add(key);
			continue;
		}
		if (same(there, schedule)) continue;
		const id = suffixedName(key, ids);
		ids.add(id);
		plan.schedules[key] = id;
	}
	return plan;
}

/**
 * Merges the source's flows, their revisions and its schedules into the
 * destination. The history first, then the flows and schedules in one
 * change: a merge cut short runs again from the start. Returns what it
 * renamed.
 */
export async function mergeFlowDocuments(
	source: FlowDocument,
	destination: FlowDocument,
	options: { persons?: Readonly<Record<string, string>>; at: number },
): Promise<FlowMergePlan> {
	const persons = options.persons ?? {};
	const plan = planFlowMerge(source, destination, persons);

	const history = source.history.doc;
	const flowIds = [...history.share.keys()];
	await destination.history.change(() => {
		for (const flowId of flowIds) {
			const into = destination.history.doc.getArray(flowId);
			const known = new Set(
				into.toArray().flatMap((revision) => {
					const id = (revision as { id?: unknown } | null)?.id;
					return typeof id === "string" ? [id] : [];
				}),
			);
			const added = history
				.getArray(flowId)
				.toArray()
				.filter((revision) => {
					const id = (revision as { id?: unknown } | null)?.id;
					return typeof id !== "string" || !known.has(id);
				})
				.map((revision) => withPerson(copyOf(revision), "personId", persons));
			if (added.length > 0) into.push(added);
		}
	});

	if (flowsMerged(source, destination)) return plan;
	const names = new Map(
		flowEntries(source).map((entry) => [entry.flowId, entry.name]),
	);
	await destination.current.change(() => {
		if (destination.meta.get("projectId") !== destination.projectId) {
			destination.meta.set("projectId", destination.projectId);
		}
		for (const [flowId, value] of source.flows.entries()) {
			if (destination.flows.has(flowId)) continue;
			const copy = copyOf(value);
			const name = names.get(flowId);
			const renamed = name === undefined ? undefined : plan.flows[name];
			if (renamed !== undefined && copy instanceof Y.Map) {
				copy.set("name", renamed);
			}
			destination.flows.set(flowId, copy);
		}
		for (const key of orderedKeys(source.schedules, source.scheduleOrder)) {
			const id = plan.schedules[key] ?? key;
			const schedule = scheduleOf(source, key, plan.flows, persons);
			if (destination.schedules.has(id)) continue;
			destination.schedules.set(
				id,
				isRecord(schedule) && id !== key ? { ...schedule, id } : schedule,
			);
			destination.scheduleOrder.push([id]);
		}
		for (const [key, notice] of source.notices.entries()) {
			if (!destination.notices.has(key)) {
				destination.notices.set(key, copyOf(notice));
			}
		}
		destination.meta.set(mergedKey(source.projectId), options.at);
	});
	return plan;
}

function sameFlow(a: FlowSource | undefined, b: FlowSource | undefined) {
	return (
		a !== undefined &&
		b !== undefined &&
		"json" in a &&
		"json" in b &&
		same(a.json, b.json)
	);
}

/** A schedule of the source as the destination takes it: its flow by its new name, its Person by their id there. */
function scheduleOf(
	source: FlowDocument,
	key: string,
	flows: Readonly<Record<string, string>>,
	persons: Readonly<Record<string, string>>,
): unknown {
	const schedule = copyOf(source.schedules.get(key));
	if (!isRecord(schedule)) return schedule;
	const flow = schedule.flow;
	const renamed =
		typeof flow === "string" && Object.hasOwn(flows, flow)
			? { ...schedule, flow: flows[flow] }
			: schedule;
	return withPerson(renamed, "person", persons);
}

/** The value with the Person in `field` replaced by their id in `persons`, when it names one. */
function withPerson(
	value: unknown,
	field: string,
	persons: Readonly<Record<string, string>>,
): unknown {
	if (!isRecord(value)) return value;
	const person = value[field];
	if (typeof person !== "string" || !Object.hasOwn(persons, person)) {
		return value;
	}
	return { ...value, [field]: persons[person] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** A copy of a value of a Yjs document, its shared types new ones, for another document. */
function copyOf(value: unknown): unknown {
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
