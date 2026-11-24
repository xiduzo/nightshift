import { migrateFlow } from "@nightshift/flows";
import type { FlowDocuments } from "../../../../documents";
import type { FlowMigrations } from "../../../migrations";
import type { FlowStore } from "../../application/ports";
import { type FlowRevision, olderFormat } from "../../domain/flow-json";
import { flowIdOf, flowRevisions, flowSources } from "./yjs-flow-encoding";
import { mergeFlowDocuments, planFlowMerge } from "./yjs-flow-merge";
import {
	keepOutputTypes,
	keepShapes,
	removeFlow,
	saveFlow,
	upgradedSources,
	upgradeFlows,
} from "./yjs-flow-saves";
import { dismissNotice, flowNotices, noteOnce } from "./yjs-notices";
import {
	readSchedules,
	saveSchedules,
	upgradeSchedules,
} from "./yjs-schedules";

/**
 * The flow documents of this Replica's Projects as the `FlowStore`. Each
 * call opens the Project's document and does what the `yjs-*.ts` files of
 * this folder do with it. `migrations` brings a flow of an older format,
 * a revision of it, and the schedules, to the current format. Without it,
 * a node keeps its profile's name, a Device name is to choose again, and
 * nothing upgrades.
 */
export function yjsFlowStore(deps: {
	documents: Pick<FlowDocuments, "open" | "openAll">;
	migrations?: FlowMigrations;
}): FlowStore {
	const { documents, migrations } = deps;
	const open = (projectId: string) => documents.open(projectId);

	return {
		async read(projectId, at) {
			return upgradedSources(
				await open(projectId),
				migrations,
				at.deviceId,
				at.spaceId,
			);
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

		async revisions(projectId, name, spaceId) {
			const document = await open(projectId);
			const flowId = flowIdOf(document, name);
			if (flowId === null) return [];
			const revisions = flowRevisions(document, flowId);
			if (!migrations) return revisions;
			// A revision of an older format reads as the Device that saved it named its profiles and Devices.
			return Promise.all(
				revisions.map(async (revision) =>
					olderFormat(revision.flow)
						? {
								...revision,
								flow: migrateFlow(
									revision.flow,
									await migrations.forDevice(
										revision.deviceId,
										spaceId === undefined
											? undefined
											: { spaceId, personId: revision.personId },
									),
								) as FlowRevision["flow"],
							}
						: revision,
				),
			);
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

		async projectIds() {
			return (await documents.openAll()).map((document) => document.projectId);
		},

		async upgrade(projectId, upgrade) {
			if (!migrations) return;
			const document = await open(projectId);
			await upgradeFlows(document, { migrations, ...upgrade });
			await upgradeSchedules(document);
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
