import type { FlowDocuments } from "../../../../documents";
import type { FlowStore } from "../../application/ports";
import { flowIdOf, flowRevisions, flowSources } from "./yjs-flow-encoding";
import { mergeFlowDocuments, planFlowMerge } from "./yjs-flow-merge";
import {
	keepOutputTypes,
	keepShapes,
	removeFlow,
	saveFlow,
} from "./yjs-flow-saves";
import { dismissNotice, flowNotices, noteOnce } from "./yjs-notices";
import { readSchedules, saveSchedules } from "./yjs-schedules";

/**
 * The flow documents of this Replica's Projects as the `FlowStore`. Each
 * call opens the Project's document and does what the `yjs-*.ts` files of
 * this folder do with it.
 */
export function yjsFlowStore(deps: {
	documents: Pick<FlowDocuments, "open">;
}): FlowStore {
	const { documents } = deps;
	const open = (projectId: string) => documents.open(projectId);

	return {
		async read(projectId) {
			return flowSources(await open(projectId));
		},

		async save(projectId, save) {
			const document = await open(projectId);
			await saveFlow(document, save);
			return flowSources(document);
		},

		async remove(projectId, name) {
			await removeFlow(await open(projectId), name);
		},

		async keepShapes(projectId, keep) {
			return (await keepShapes(await open(projectId), keep)) !== null;
		},

		async keepOutputTypes(projectId, keep) {
			return (await keepOutputTypes(await open(projectId), keep)) !== null;
		},

		async revisions(projectId, name) {
			const document = await open(projectId);
			const flowId = flowIdOf(document, name);
			return flowId === null ? [] : flowRevisions(document, flowId);
		},

		async schedules(projectId) {
			return readSchedules(await open(projectId));
		},

		async saveSchedules(projectId, schedules) {
			await saveSchedules(await open(projectId), schedules);
		},

		async notices(projectId) {
			return flowNotices(await open(projectId));
		},

		async note(projectId, marker, notice) {
			await noteOnce(await open(projectId), marker, notice);
		},

		async dismissNotice(projectId, noticeId) {
			await dismissNotice(await open(projectId), noticeId);
		},

		async planMerge(source, destination, persons) {
			return planFlowMerge(
				await open(source),
				await open(destination),
				persons,
			);
		},

		async merge(source, destination, merge) {
			return mergeFlowDocuments(
				await open(source),
				await open(destination),
				merge,
			);
		},
	};
}
