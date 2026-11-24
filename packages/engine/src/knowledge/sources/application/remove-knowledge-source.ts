import type { Permissions } from "@nightshift/auth";
import { Refusal } from "@nightshift/refusal";
import type { Access } from "../../../access";
import type { Actor } from "../../../contract";
import type { KnowledgeReconciler } from "../../sync";
import { foldersOf, foldersOthersFill } from "../domain/source-flows";
import {
	OWNER_ONLY,
	type SourceRights,
	savedSchedules,
	sourceNamed,
} from "../domain/syncs";
import type { SourcesSpace } from "./ports";

const REMOVES_FLOWS: Permissions = { flow: ["remove"] };
const CHANGES_KNOWLEDGE: Permissions = { run: ["start"] };

export type RemoveKnowledgeSourcePorts = {
	access: Pick<Access, "openSpace">;
	space: Pick<SourcesSpace, "flows" | "listSchedules" | "saveSchedules">;
	reconciler: Pick<KnowledgeReconciler, "removeFolder">;
};

/** The source to remove, by its flow's name, and what the person may do. */
export type RemoveKnowledgeSource = {
	spaceId: string;
	projectId: string;
	name: string;
	/** Remove the files of its folders too. */
	files: boolean;
	may: SourceRights;
};

/**
 * Removes a source the page added: with `files`, the files of its folders
 * that no other flow fills, for every Device of the Space; then its
 * schedules (cron and webhook); then its flow. Every check comes first,
 * and the files go first: a step that fails leaves the source in place,
 * so the person can try again. Returns how many files it removed.
 *
 * Refuses a Person who may not remove the source (`access.openSpace`).
 */
export const removeKnowledgeSource =
	(ports: RemoveKnowledgeSourcePorts) =>
	async (
		actor: Actor,
		{ spaceId, projectId, name, files, may }: RemoveKnowledgeSource,
	): Promise<{ removedFiles: number }> => {
		await ports.access.openSpace(actor, { spaceId, need: REMOVES_FLOWS });
		if (files) {
			await ports.access.openSpace(actor, {
				spaceId,
				need: CHANGES_KNOWLEDGE,
			});
		}
		const { space } = ports;
		const { flows, flow } = sourceNamed(await space.flows.map(projectId), name);
		const schedules = await savedSchedules(() =>
			space.listSchedules(projectId),
		);
		const kept = schedules.filter((schedule) => schedule.flow !== name);
		if (kept.length < schedules.length && !may.schedules) {
			throw new Refusal("forbidden", OWNER_ONLY);
		}
		let removedFiles = 0;
		if (files) {
			const others = foldersOthersFill(flows, name);
			for (const folder of foldersOf(flow)) {
				if (others.has(folder)) continue;
				removedFiles += await ports.reconciler.removeFolder(projectId, folder);
			}
		}
		if (kept.length < schedules.length) {
			await space.saveSchedules(projectId, kept);
		}
		await space.flows.remove(projectId, name);
		return { removedFiles };
	};
