import type { MeaningModel, SearchIndex } from "./ports";
import type { KnowledgeRefresh } from "./refresh-search-index";

export type ReadIndexForMapPorts = {
	index: Pick<
		SearchIndex,
		"healing" | "files" | "sectionTexts" | "storedVectors"
	>;
	meaning: MeaningModel;
	/** Whether a person left search by meaning on for the project. Never throws. */
	meaningOn(projectId: string): Promise<boolean>;
	/** The project's index brought up to date first (`refreshSearchIndex`). */
	refresh(request: { projectId: string }): Promise<KnowledgeRefresh>;
};

/** What the Map reads of the index, at most. */
type MapLimits = {
	maxBytes: number;
	maxBytesPerFile: number;
	maxVectors: number;
};

/** The project of the Map, and how much of the index it reads at most. */
export type ReadIndexForMap = { projectId: string; limits: MapLimits };

/** What the index holds for the Map. */
export type IndexForMap = {
	/** Every file it has. */
	files: string[];
	read: { path: string; sections: string[] }[];
	filesLeftOut: number;
	vectors: { path: string; vector: Float32Array }[];
	/** The line for files close in meaning. Null: no model, or none measured. */
	closeAt: number | null;
};

/**
 * Gives what the index holds for the Map, after a refresh: the files, the
 * text of their sections, and the vectors that are ready. It walks this
 * computer's folder. It asks neither the Host nor the model, so the vectors
 * of a model that does not answer now still count. Search by meaning off for
 * the project, or a model nobody measured: no vectors.
 */
export const readIndexForMap =
	(ports: ReadIndexForMapPorts) =>
	async ({ projectId, limits }: ReadIndexForMap): Promise<IndexForMap> => {
		const { index } = ports;
		const meaning = ports.meaning.current();
		const closeAt = meaning?.closeAt ?? null;
		const on = closeAt !== null && (await ports.meaningOn(projectId));
		return index.healing(async () => {
			await ports.refresh({ projectId });
			return {
				files: [...index.files(projectId).keys()],
				...index.sectionTexts(projectId, limits),
				vectors:
					meaning && on
						? index.storedVectors(projectId, meaning.model, limits.maxVectors)
						: [],
				closeAt,
			};
		});
	};
