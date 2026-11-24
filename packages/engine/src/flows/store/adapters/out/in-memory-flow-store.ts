import {
	FLOW_VERSION,
	type FlowSources,
	type Schedule,
	suffixedName,
} from "@nightshift/flows";
import type { FlowStore } from "../../application/ports";
import { type FlowRevision, formatOf, same } from "../../domain/flow-json";
import {
	apartNames,
	mergedSchedule,
	withCalls,
	withPerson,
} from "../../domain/flow-merge";
import { flowNotFound, foreignFlow } from "../../domain/flow-save";
import { nodeWithShape, outputsWithTypes } from "../../domain/inferred";
import type { FlowNotice } from "../../domain/notices";

/** One flow of the twin's document. */
type StoredFlow = {
	flowId: string;
	name: string;
	json: Record<string, unknown>;
};

/** The twin's flow document of one Project. */
type StoredDocument = {
	flows: StoredFlow[];
	revisions: Map<string, FlowRevision[]>;
	schedules: Schedule[];
	notices: FlowNotice[];
	merged: Set<string>;
	/** The notices that were added once (`note`). */
	marks: Set<string>;
};

/** The in-memory `FlowStore`, with what a test sets and reads. */
export type InMemoryFlowStore = FlowStore & {
	/** Gives a Project a document. */
	seed(projectId: string, notices?: FlowNotice[]): void;
	/** Makes the stored flow of that name one of the format before this one. */
	putOlder(projectId: string, name: string): void;
	/** Every Project read, in order. */
	reads: string[];
};

/** As JSON: without `undefined` fields, and shared with nothing. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * The flows of each Project in memory. Ids count up from 1 (`flow-1`, `revision-1`, `notice-1`).
 */
export function inMemoryFlowStore(): InMemoryFlowStore {
	const documents = new Map<string, StoredDocument>();
	let notes = 0;
	let counter = 0;
	const next = (kind: string) => `${kind}-${++counter}`;

	function documentOf(projectId: string): StoredDocument {
		let document = documents.get(projectId);
		if (!document) {
			document = {
				flows: [],
				revisions: new Map(),
				schedules: [],
				notices: [],
				marks: new Set(),
				merged: new Set(),
			};
			documents.set(projectId, document);
		}
		return document;
	}

	function sourcesOf(document: StoredDocument): FlowSources {
		const sources: FlowSources = {};
		for (const flow of [...document.flows].sort((a, b) =>
			a.name < b.name ? -1 : 1,
		)) {
			const last = document.revisions.get(flow.flowId)?.at(-1);
			sources[flow.name] =
				last !== undefined && same(last.flow, flow.json)
					? { json: plain(flow.json), revision: last.id }
					: { json: plain(flow.json) };
		}
		return sources;
	}

	function addRevision(
		document: StoredDocument,
		flowId: string,
		revision: Omit<FlowRevision, "id">,
	): void {
		const list = document.revisions.get(flowId) ?? [];
		list.push({ id: next("revision"), ...plain(revision) });
		document.revisions.set(flowId, list);
	}

	/** The flow of that name, of this format, or null. */
	const current = (document: StoredDocument, name: string) => {
		const flow = document.flows.find((candidate) => candidate.name === name);
		return flow && flow.json.version === FLOW_VERSION ? flow : null;
	};

	const store: InMemoryFlowStore = {
		reads: [],

		seed(projectId, notices = []) {
			documentOf(projectId).notices.push(...notices);
		},

		putOlder(projectId, name) {
			const flow = current(documentOf(projectId), name);
			if (flow) flow.json.version = FLOW_VERSION - 1;
		},

		async read(projectId) {
			store.reads.push(projectId);
			return sourcesOf(documentOf(projectId));
		},

		async save(projectId, save) {
			const document = documentOf(projectId);
			const found = document.flows.find((flow) => flow.name === save.name);
			const format = formatOf(Number(found?.json.version ?? FLOW_VERSION));
			if (format !== "current") throw foreignFlow(save.name, format);
			const snapshot = plain({ ...save.flow, version: FLOW_VERSION });
			const flow = found ?? {
				flowId: next("flow"),
				name: save.name,
				json: snapshot,
			};
			if (!found) document.flows.push(flow);
			flow.json = snapshot;
			const last = document.revisions.get(flow.flowId)?.at(-1);
			if (last === undefined || !same(last.flow, snapshot)) {
				addRevision(document, flow.flowId, {
					at: save.at,
					personId: save.personId,
					deviceId: save.deviceId,
					kind: save.kind,
					flow: snapshot as FlowRevision["flow"],
				});
			}
			return sourcesOf(document);
		},

		async remove(projectId, name) {
			const document = documentOf(projectId);
			const index = document.flows.findIndex((flow) => flow.name === name);
			if (index === -1) throw flowNotFound(name);
			document.flows.splice(index, 1);
		},

		async keepShapes(projectId, keep) {
			const document = documentOf(projectId);
			const flow = current(document, keep.name);
			if (!flow) return false;
			const nodes = flow.json.nodes as { id: string }[];
			const index = nodes.findIndex((node) => node.id === keep.node.id);
			const node = nodeWithShape(nodes[index], keep.node.type, keep.shapes);
			if (node === null) return false;
			nodes[index] = plain(node) as { id: string };
			addRevision(document, flow.flowId, {
				at: keep.at,
				personId: null,
				deviceId: keep.deviceId,
				kind: "infer",
				flow: flow.json as FlowRevision["flow"],
			});
			return true;
		},

		async keepOutputTypes(projectId, keep) {
			const document = documentOf(projectId);
			const flow = current(document, keep.name);
			if (!flow) return false;
			const outputs = outputsWithTypes(flow.json.outputs, keep.types);
			if (outputs === null) return false;
			flow.json.outputs = plain(outputs);
			addRevision(document, flow.flowId, {
				at: keep.at,
				personId: null,
				deviceId: keep.deviceId,
				kind: "infer",
				flow: flow.json as FlowRevision["flow"],
			});
			return true;
		},

		async revisions(projectId, name) {
			const document = documentOf(projectId);
			const flow = document.flows.find((candidate) => candidate.name === name);
			return plain(document.revisions.get(flow?.flowId ?? "") ?? []);
		},

		async schedules(projectId) {
			return {
				schedules: plain(documentOf(projectId).schedules),
				unreadable: 0,
			};
		},

		async saveSchedules(projectId, schedules) {
			documentOf(projectId).schedules = plain([...schedules]);
		},

		async notices(projectId) {
			return [...documentOf(projectId).notices];
		},

		async note(projectId, marker, notice) {
			const document = documentOf(projectId);
			if (document.marks.has(marker)) return;
			document.marks.add(marker);
			document.notices.push({ id: `notice-${++notes}`, ...notice });
		},

		async dismissNotice(projectId, noticeId) {
			const document = documentOf(projectId);
			document.notices = document.notices.filter(
				(notice) => notice.id !== noticeId,
			);
		},

		async planMerge(source, destination, persons) {
			const from = documentOf(source);
			const into = documentOf(destination);
			const plan = { flows: {}, schedules: {} } as {
				flows: Record<string, string>;
				schedules: Record<string, string>;
			};
			if (into.merged.has(source)) return plan;
			const taken = new Set(into.flows.map((flow) => flow.name));
			for (const flow of from.flows) {
				if (into.flows.some((other) => other.flowId === flow.flowId)) continue;
				const there = into.flows.find((other) => other.name === flow.name);
				if (there && same(there.json, flow.json)) continue;
				const name = suffixedName(flow.name, taken);
				taken.add(name);
				if (name !== flow.name) plan.flows[flow.name] = name;
			}
			const ids = new Set(into.schedules.map((schedule) => schedule.id));
			for (const schedule of from.schedules) {
				const there = into.schedules.find((other) => other.id === schedule.id);
				if (there === undefined) {
					ids.add(schedule.id);
					continue;
				}
				if (same(there, mergedSchedule(schedule, plan.flows, persons))) {
					continue;
				}
				const id = suffixedName(schedule.id, ids);
				ids.add(id);
				plan.schedules[schedule.id] = id;
			}
			return plan;
		},

		async merge(source, destination, merge) {
			const persons = merge.persons ?? {};
			const { apart } = merge;
			const from = documentOf(source);
			const into = documentOf(destination);
			const plan =
				apart === undefined
					? await store.planMerge(source, destination, persons)
					: {
							flows: apartNames(
								from.flows.map((flow) => flow.name),
								apart,
								new Set(into.flows.map((flow) => flow.name)),
							),
							schedules: apartNames(
								from.schedules.map((s) => s.id),
								apart,
								new Set(into.schedules.map((s) => s.id)),
							),
						};
			for (const [flowId, revisions] of from.revisions) {
				const list = into.revisions.get(flowId) ?? [];
				const known = new Set(list.map((revision) => revision.id));
				for (const revision of revisions) {
					if (known.has(revision.id)) continue;
					list.push(
						withPerson(plain(revision), "personId", persons) as FlowRevision,
					);
				}
				into.revisions.set(flowId, list);
			}
			if (into.merged.has(source)) return plan;
			for (const flow of from.flows) {
				if (into.flows.some((other) => other.flowId === flow.flowId)) continue;
				const copy = plain(flow);
				if (apart !== undefined && Array.isArray(copy.json.nodes)) {
					copy.json.nodes = copy.json.nodes.map((node) =>
						withCalls(node, plan.flows),
					);
				}
				into.flows.push({
					...copy,
					name: plan.flows[flow.name] ?? flow.name,
				});
			}
			for (const schedule of from.schedules) {
				const id = plan.schedules[schedule.id] ?? schedule.id;
				if (into.schedules.some((other) => other.id === id)) continue;
				const merged = mergedSchedule(plain(schedule), plan.flows, persons);
				into.schedules.push({
					...(merged as Schedule),
					id,
					...(apart === undefined ? {} : { enabled: false }),
				});
			}
			into.notices.push(
				...from.notices.filter(
					(notice) => !into.notices.some((other) => other.id === notice.id),
				),
			);
			into.merged.add(source);
			return plan;
		},
	};
	return store;
}
