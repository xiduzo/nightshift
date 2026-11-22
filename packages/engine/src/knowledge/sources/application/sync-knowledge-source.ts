import { type SourceRun, sourceNamed } from "../domain/syncs";
import type { SourcesSpace } from "./ports";

export type SyncKnowledgeSourcePorts<Run extends SourceRun> = {
	space: Pick<SourcesSpace<Run>, "flows" | "startRun">;
};

/** The source to sync, by its flow's name, and who starts its run. */
export type SyncKnowledgeSource = {
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
 * It checks no role: the API checked who may start runs (E-doors moves it here).
 */
export const syncKnowledgeSource =
	<Run extends SourceRun>(ports: SyncKnowledgeSourcePorts<Run>) =>
	async ({ projectId, name, startedBy }: SyncKnowledgeSource): Promise<Run> => {
		sourceNamed(await ports.space.flows.map(projectId), name);
		return ports.space.startRun({ projectId, flowName: name, startedBy });
	};
