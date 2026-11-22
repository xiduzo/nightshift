import type { KnowledgeMeaningStatus } from "./meaning";
import type { KnowledgeSearchMode } from "./ranking";

/**
 * The evaluation of a project's knowledge search: its question set
 * (`questions.ts` of the knowledge) against each way to search, by words, by
 * meaning, and both fused. For each way: how many questions found a right
 * file in the top 5 (recall at 5), the rank of the first right file of each
 * question, and for a question with several right files, how many of them it
 * found and how high (all in the top 5, nDCG at 10). Recall at 5 stays the
 * headline: the advice reads only that. A plain loop over the search
 * (`evaluateSearch`): the same search the agents get.
 */

/**
 * The thresholds of the evaluation, in one place. They come from the
 * vectors spike, `docs/research/knowledge-vectors.md` §1 ("Threshold"):
 * keep search by meaning only when both fused beat words alone by at
 * least 10 points of recall at 5, measured on at least 20 marked
 * questions. On that repo's docs, words found 16 to 19 of 26 and both 22
 * to 23.
 */
export const EVALUATION = {
	/** A right file in the top `k` counts as found. */
	k: 5,
	/** How deep a search looks for the rank of the first right file. */
	depth: 20,
	/** How deep nDCG looks. */
	ndcgK: 10,
	/** Below this many marked questions, the numbers decide nothing. */
	minQuestions: 20,
	/** Search by meaning earns its keep when both fused beat words alone by this many points. */
	minGainPoints: 10,
} as const;

/** A marked question: what was asked, and the files that answer it. */
export type EvaluatedQuestion = { query: string; answers: string[] };

/** How one way to search did on the question set. */
type KnowledgeModeResult = {
	/** Questions with a right file in the top `k`. */
	found: number;
	/** `found` of all questions, 0 to 1. */
	recall: number;
	/** The mean of 1 / rank of the first right file, 0 for one not in the top `depth`. */
	mrr: number;
	/** Questions with all their right files in the top `k`. */
	allFound: number;
	/** The mean nDCG at `ndcgK`, 0 to 1: every right file counts, and a higher rank counts more. */
	ndcg: number;
};

/** One question of the set, and where each way to search ranked its first right file (null: not in the top `depth`). */
export type KnowledgeEvaluationRow = {
	query: string;
	answers: string[];
	ranks: Record<KnowledgeSearchMode, number | null>;
};

/**
 * What the numbers say about search by meaning for the project:
 * `too-few`: fewer than `minQuestions` marked questions. `keep`: both
 * fused beat words alone by `minGainPoints` or more. `turn-off`: they do
 * not, so words alone find as much. `unavailable`: search by meaning does
 * not work for the project on this computer now (`meaning.state` says
 * why), so only words are measured.
 */
type KnowledgeEvaluationAdvice =
	| "too-few"
	| "keep"
	| "turn-off"
	| "unavailable";

export type KnowledgeEvaluation = {
	/** Epoch ms. */
	at: number;
	questions: number;
	k: number;
	minQuestions: number;
	minGainPoints: number;
	/** Search by meaning on this computer for the project, as the evaluation found it. */
	meaning: KnowledgeMeaningStatus;
	/** Each way to search. Null: not measured, search by meaning does not work now. */
	modes: Record<KnowledgeSearchMode, KnowledgeModeResult | null>;
	rows: KnowledgeEvaluationRow[];
	advice: KnowledgeEvaluationAdvice;
};

export const MODES: readonly KnowledgeSearchMode[] = [
	"words",
	"meaning",
	"both",
];

/** The ways to search the evaluation measures: partly prepared vectors would measure part of the knowledge. */
export const measuredModes = (meaning: KnowledgeMeaningStatus) =>
	MODES.filter((mode) => mode === "words" || meaning.state === "on");

/** The ranks of a question's right files among the paths a search found, from 1. */
export const answerRanks = (
	answers: readonly string[],
	paths: readonly string[],
): number[] =>
	[...new Set(answers)]
		.map((answer) => paths.indexOf(answer) + 1)
		.filter((rank) => rank > 0);

/** How one way to search did: null when it was not measured. */
export function modeResult(
	mode: KnowledgeSearchMode,
	measured: readonly KnowledgeSearchMode[],
	rows: readonly KnowledgeEvaluationRow[],
	ranksOf: Record<KnowledgeSearchMode, number[][]>,
): KnowledgeModeResult | null {
	if (!measured.includes(mode)) return null;
	const found = rows.filter((row) => {
		const rank = row.ranks[mode];
		return rank !== null && rank <= EVALUATION.k;
	}).length;
	const mrr =
		rows.reduce(
			(sum, row) => sum + 1 / (row.ranks[mode] ?? Number.POSITIVE_INFINITY),
			0,
		) / Math.max(rows.length, 1);
	const allFound = rows.filter(
		(row, i) =>
			(ranksOf[mode][i] ?? []).filter((rank) => rank <= EVALUATION.k).length ===
			new Set(row.answers).size,
	).length;
	const ndcg =
		rows.reduce(
			(sum, row, i) =>
				sum + ndcgOf(ranksOf[mode][i] ?? [], new Set(row.answers).size),
			0,
		) / Math.max(rows.length, 1);
	return {
		found,
		recall: rows.length === 0 ? 0 : found / rows.length,
		mrr,
		allFound,
		ndcg,
	};
}

/** nDCG at `ndcgK` of one question: a right file is worth 1, its rank discounts it. */
function ndcgOf(ranks: readonly number[], answers: number): number {
	const gain = (rank: number) => 1 / Math.log2(rank + 1);
	const dcg = ranks
		.filter((rank) => rank <= EVALUATION.ndcgK)
		.reduce((sum, rank) => sum + gain(rank), 0);
	let ideal = 0;
	for (let rank = 1; rank <= Math.min(answers, EVALUATION.ndcgK); rank++) {
		ideal += gain(rank);
	}
	return ideal === 0 ? 0 : dcg / ideal;
}

/** What the numbers say about search by meaning: see `KnowledgeEvaluationAdvice`. */
export function adviceOf(
	questions: number,
	words: KnowledgeModeResult | null,
	both: KnowledgeModeResult | null,
): KnowledgeEvaluationAdvice {
	if (!words || !both) return "unavailable";
	if (questions < EVALUATION.minQuestions) return "too-few";
	const gain = (both.recall - words.recall) * 100;
	return gain >= EVALUATION.minGainPoints ? "keep" : "turn-off";
}
