import type { Permissions } from "@nightshift/auth";
import type { Access } from "../../../access";
import type { Actor } from "../../../contract";
import { type SourceRun, sourceNamed } from "../domain/syncs";
import type { SourcesSpace } from "./ports";

const CHANGES_KNOWLEDGE: Permissions = { run: ["start"] };

export type SyncKnowledgeSourcePorts<Run extends SourceRun> = {
	access: Pick<Access, "openSpace">;
	space: Pick<SourcesSpace<Run>, "flows" | "startRun">;
};

/** The source to sync, by its flow's name, and who starts its run. */
export type SyncKnowledgeSource = {
	actor: Actor;
	spaceId: string;
	projectId: string;
	name: string;
	startedBy: string;
};

/**
 * Syncs a source now: a run of its flow, as any run. A folder source's
 * Subflow runs on the computer it names. A schedule that names a computer
 * (an older folder source, or one a person set on the Schedules page)
 * still places the run there. A flow that is no source refuses.
 *
 * Refuses a Person who may not change knowledge (`access.openSpace`).
 */
export const syncKnowledgeSource =
	<Run extends SourceRun>(ports: SyncKnowledgeSourcePorts<Run>) =>
	async ({
		actor,
		spaceId,
		projectId,
		name,
		startedBy,
	}: SyncKnowledgeSource): Promise<Run> => {
		await ports.access.openSpace(actor, { spaceId, need: CHANGES_KNOWLEDGE });
		sourceNamed(await ports.space.flows.map(projectId), name);
		return ports.space.startRun({ projectId, flowName: name, startedBy });
	};
