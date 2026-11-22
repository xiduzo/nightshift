import type { KnowledgeMeaningStatus } from "../domain/meaning";
import { readinessOf, type VectorStates } from "../domain/vector-states";
import type { MeaningModel, SearchIndex } from "./ports";
import type { KnowledgeRefresh } from "./refresh-search-index";

export type ReadMeaningStatusPorts = {
	index: Pick<SearchIndex, "healing" | "sectionCount" | "vectorsFor">;
	meaning: MeaningModel;
	/** Whether a person left search by meaning on for the project. Never throws. */
	meaningOn(projectId: string): Promise<boolean>;
	/** The project's index brought up to date first (`refreshSearchIndex`). */
	refresh(request: { projectId: string }): Promise<KnowledgeRefresh>;
	states: Pick<VectorStates, "heardReady" | "stateOf">;
	/** Queues the project's vectors (`prepareVectors`). */
	prepare(request: { projectId: string }): void;
};

/** The project to ask about. */
export type ReadMeaningStatus = { projectId: string };

/**
 * Says whether search by meaning works for a project on this computer,
 * after a refresh. Starts the preparation of its vectors when they are
 * behind.
 */
export const readMeaningStatus =
	(ports: ReadMeaningStatusPorts) =>
	async ({ projectId }: ReadMeaningStatus): Promise<KnowledgeMeaningStatus> => {
		const { index, states } = ports;
		const meaning = ports.meaning.current();
		if (!meaning) {
			return {
				state: "off",
				model: null,
				done: 0,
				total: 0,
				where: null,
				percent: null,
			};
		}
		const where = meaning.where ?? null;
		if (!(await ports.meaningOn(projectId))) {
			return {
				state: "turned-off",
				model: meaning.model,
				done: 0,
				total: 0,
				where,
				percent: null,
			};
		}
		const ready = await readinessOf(meaning, states, console.info);
		if (ready !== "ready") {
			return {
				state: ready,
				model: meaning.model,
				done: 0,
				total: 0,
				where,
				percent: ready === "downloading" ? (meaning.downloaded?.() ?? 0) : null,
			};
		}
		return index.healing(async () => {
			await ports.refresh({ projectId });
			const total = index.sectionCount(projectId);
			// Before the state is read: another model makes every project behind.
			const vectors = index.vectorsFor(projectId, meaning);
			if (states.stateOf(projectId) === "ready") {
				return {
					state: "on",
					model: meaning.model,
					done: total,
					total,
					where,
					percent: null,
				};
			}
			ports.prepare({ projectId });
			return {
				state: states.stateOf(projectId) === "failed" ? "failed" : "preparing",
				model: meaning.model,
				done: Math.min(vectors.count(), total),
				total,
				where,
				percent: null,
			};
		});
	};
