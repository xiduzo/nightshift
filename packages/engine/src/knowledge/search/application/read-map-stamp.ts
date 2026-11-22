import type { MeaningModel, SearchIndex } from "./ports";
import type { KnowledgeRefresh } from "./refresh-search-index";

export type ReadMapStampPorts = {
	index: Pick<SearchIndex, "healing" | "mapStamp">;
	meaning: MeaningModel;
	/** Whether a person left search by meaning on for the project. Never throws. */
	meaningOn(projectId: string): Promise<boolean>;
	/** The project's index brought up to date first (`refreshSearchIndex`). */
	refresh(request: { projectId: string }): Promise<KnowledgeRefresh>;
};

/** The project of the Map. */
export type ReadMapStamp = { projectId: string };

/**
 * After a refresh, a text that changes when what the Map reads of the index
 * (`readIndexForMap`) would give something else. It walks this computer's
 * folder, and it reads no section and no vector, so it costs little against
 * what the Map reads.
 */
export const readMapStamp =
	(ports: ReadMapStampPorts) =>
	async ({ projectId }: ReadMapStamp): Promise<string> => {
		const meaning = ports.meaning.current();
		const closeAt = meaning?.closeAt ?? null;
		const on = closeAt !== null && (await ports.meaningOn(projectId));
		return ports.index.healing(async () => {
			await ports.refresh({ projectId });
			return JSON.stringify([
				closeAt,
				on ? meaning?.model : null,
				ports.index.mapStamp(projectId),
			]);
		});
	};
