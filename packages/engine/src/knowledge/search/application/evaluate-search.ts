import {
	adviceOf,
	answerRanks,
	EVALUATION,
	type EvaluatedQuestion,
	type KnowledgeEvaluation,
	type KnowledgeEvaluationRow,
	measuredModes,
	modeResult,
} from "../domain/evaluation";
import type { KnowledgeMeaningStatus } from "../domain/meaning";
import type { KnowledgeHit, KnowledgeSearchMode } from "../domain/ranking";
import type { SearchKnowledge } from "./search-knowledge";

export type EvaluateSearchPorts = {
	/** The search the agents get (`searchKnowledge`). */
	search(request: SearchKnowledge): Promise<KnowledgeHit[]>;
	/** Whether search by meaning works for the project now (`readMeaningStatus`). */
	meaning(request: { projectId: string }): Promise<KnowledgeMeaningStatus>;
	now: () => number;
};

/** The project, and its question set. */
export type EvaluateSearch = {
	projectId: string;
	questions: readonly EvaluatedQuestion[];
};

/** Runs a project's question set against each way to search. */
export const evaluateSearch =
	(ports: EvaluateSearchPorts) =>
	async ({
		projectId,
		questions,
	}: EvaluateSearch): Promise<KnowledgeEvaluation> => {
		const meaning = await ports.meaning({ projectId });
		const measured = measuredModes(meaning);
		const rows: KnowledgeEvaluationRow[] = [];
		const ranksOf: Record<KnowledgeSearchMode, number[][]> = {
			words: [],
			meaning: [],
			both: [],
		};
		for (const question of questions) {
			const ranks: Record<KnowledgeSearchMode, number | null> = {
				words: null,
				meaning: null,
				both: null,
			};
			for (const mode of measured) {
				const hits = await ports.search({
					projectId,
					text: question.query,
					limit: EVALUATION.depth,
					mode,
				});
				const found = answerRanks(
					question.answers,
					hits.map((hit) => hit.path),
				);
				ranks[mode] = found.length > 0 ? Math.min(...found) : null;
				ranksOf[mode].push(found);
			}
			rows.push({ query: question.query, answers: question.answers, ranks });
		}
		const modes = {
			words: modeResult("words", measured, rows, ranksOf),
			meaning: modeResult("meaning", measured, rows, ranksOf),
			both: modeResult("both", measured, rows, ranksOf),
		};
		return {
			at: ports.now(),
			questions: rows.length,
			k: EVALUATION.k,
			minQuestions: EVALUATION.minQuestions,
			minGainPoints: EVALUATION.minGainPoints,
			meaning,
			modes,
			rows,
			advice: adviceOf(rows.length, modes.words, modes.both),
		};
	};
