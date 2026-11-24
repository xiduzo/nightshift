import { suffixedName } from "@nightshift/flows";
import * as Y from "yjs";
import type { FlowDocument } from "../../../../documents";
import { same } from "../../domain/flow-json";
import {
	apartId,
	type FlowMergePlan,
	isRecord,
	mergedSchedule,
	NEVER_OLDER,
	sameFlow,
	withPerson,
} from "../../domain/flow-merge";
import {
	copyOf,
	flowEntries,
	flowSources,
	mapsOf,
	orderedKeys,
} from "./yjs-flow-encoding";
import { marked } from "./yjs-notices";

/**
 * The merge of the flow document of one Project into the flow document
 * of another (`domain/flow-merge.ts` says what it keeps): what a Project
 * that maps onto a Project of another Space (`spaceMoveBatch`) does with
 * its flows and schedules.
 */

/** The key in `meta` that says the source merged into this document. */
const mergedKey = (projectId: string) => `mergedFrom:${projectId}`;

/** Whether the source's flows and schedules merged into the destination already. */
function flowsMerged(
	source: Pick<FlowDocument, "projectId">,
	destination: FlowDocument,
): boolean {
	return marked(destination, mergedKey(source.projectId));
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
	const from = mapsOf(source);
	const into = mapsOf(destination);
	const taken = new Set(
		flowEntries(destination).flatMap((entry) => [entry.name, entry.stored]),
	);
	const theirs = flowSources(destination);
	const ours = flowSources(source);
	for (const entry of flowEntries(source)) {
		if (into.flows.has(entry.flowId)) continue;
		// The same flow on both sides keeps its name: a read takes the older.
		if (sameFlow(ours[entry.name], theirs[entry.name])) continue;
		const name = suffixedName(entry.name, taken);
		taken.add(name);
		if (name !== entry.name) plan.flows[entry.name] = name;
	}
	const ids = new Set(into.schedules.keys());
	for (const key of orderedKeys(from.schedules, from.scheduleOrder)) {
		const schedule = mergedSchedule(
			copyOf(from.schedules.get(key)),
			plan.flows,
			persons,
		);
		const there = into.schedules.get(key);
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

/** Every schedule under an id of its own: those of the destination are not all here. */
function apartPlan(source: FlowDocument, apart: string): FlowMergePlan {
	const from = mapsOf(source);
	const ids = orderedKeys(from.schedules, from.scheduleOrder);
	return {
		flows: {},
		schedules: Object.fromEntries(ids.map((id) => [id, apartId(id, apart)])),
	};
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
	options: {
		persons?: Readonly<Record<string, string>>;
		at: number;
		/** The destination is not all here: what merges keeps apart from what comes (`domain/flow-merge.ts`). */
		apart?: string;
	},
): Promise<FlowMergePlan> {
	const persons = options.persons ?? {};
	const plan =
		options.apart === undefined
			? planFlowMerge(source, destination, persons)
			: apartPlan(source, options.apart);

	const history = source.history.doc;
	const flowIds = [...history.share.keys()];
	await destination.history.change(() => {
		for (const flowId of flowIds) {
			const revisions = destination.history.doc.getArray(flowId);
			const known = new Set(
				revisions.toArray().flatMap((revision) => {
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
			if (added.length > 0) revisions.push(added);
		}
	});

	if (flowsMerged(source, destination)) return plan;
	const from = mapsOf(source);
	const into = mapsOf(destination);
	const names = new Map(
		flowEntries(source).map((entry) => [entry.flowId, entry.name]),
	);
	await destination.current.change(() => {
		if (into.meta.get("projectId") !== destination.projectId) {
			into.meta.set("projectId", destination.projectId);
		}
		for (const [flowId, value] of from.flows.entries()) {
			if (into.flows.has(flowId)) continue;
			const copy = copyOf(value);
			const name = names.get(flowId);
			const renamed = name === undefined ? undefined : plan.flows[name];
			if (renamed !== undefined && copy instanceof Y.Map) {
				copy.set("name", renamed);
			}
			if (options.apart !== undefined && copy instanceof Y.Map) {
				copy.set("createdAt", NEVER_OLDER);
			}
			into.flows.set(flowId, copy);
		}
		for (const key of orderedKeys(from.schedules, from.scheduleOrder)) {
			const id = plan.schedules[key] ?? key;
			const schedule = mergedSchedule(
				copyOf(from.schedules.get(key)),
				plan.flows,
				persons,
			);
			if (into.schedules.has(id)) continue;
			into.schedules.set(
				id,
				isRecord(schedule) && id !== key
					? {
							...schedule,
							id,
							...(options.apart === undefined ? {} : { enabled: false }),
						}
					: schedule,
			);
			into.scheduleOrder.push([id]);
		}
		for (const [key, notice] of from.notices.entries()) {
			if (!into.notices.has(key)) {
				into.notices.set(key, copyOf(notice));
			}
		}
		into.meta.set(mergedKey(source.projectId), options.at);
	});
	return plan;
}
