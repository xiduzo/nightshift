import type { KnowledgeQuestion } from "./questions";
import type {
	KnowledgeMeaningStatus,
	KnowledgeSearch,
	KnowledgeSearchMode,
} from "./search";

/**
 * The evaluation of a project's knowledge search: its question set
 * (`questions.ts`) against each way to search, by words, by meaning, and
 * both fused. For each way: how many questions found a right file in the
 * top 5 (recall at 5), and the rank of the first right file of each
 * question. A plain loop over `KnowledgeSearch.search`: the same search
 * the agents get.
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
	/** Below this many marked questions, the numbers decide nothing. */
	minQuestions: 20,
	/** Search by meaning earns its keep when both fused beat words alone by this many points. */
	minGainPoints: 10,
} as const;

/** How one way to search did on the question set. */
export type KnowledgeModeResult = {
	/** Questions with a right file in the top `k`. */
	found: number;
	/** `found` of all questions, 0 to 1. */
	recall: number;
	/** The mean of 1 / rank of the first right file, 0 for one not in the top `depth`. */
	mrr: number;
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
export type KnowledgeEvaluationAdvice =
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

const MODES: readonly KnowledgeSearchMode[] = ["words", "meaning", "both"];

/** Runs the question set against each way to search the project's knowledge. */
export async function evaluateKnowledge(
	search: Pick<KnowledgeSearch, "search" | "meaning">,
	projectId: string,
	questions: readonly KnowledgeQuestion[],
	now: () => number = Date.now,
): Promise<KnowledgeEvaluation> {
	const meaning = await search.meaning(projectId);
	// Partly prepared vectors would measure part of the knowledge.
	const measured = MODES.filter(
		(mode) => mode === "words" || meaning.state === "on",
	);
	const rows: KnowledgeEvaluationRow[] = [];
	for (const question of questions) {
		const right = new Set(question.answers);
		const ranks: Record<KnowledgeSearchMode, number | null> = {
			words: null,
			meaning: null,
			both: null,
		};
		for (const mode of measured) {
			const hits = await search.search(projectId, question.query, {
				limit: EVALUATION.depth,
				mode,
			});
			const at = hits.findIndex((hit) => right.has(hit.path));
			ranks[mode] = at === -1 ? null : at + 1;
		}
		rows.push({ query: question.query, answers: question.answers, ranks });
	}
	const result = (mode: KnowledgeSearchMode): KnowledgeModeResult | null => {
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
		return { found, recall: rows.length === 0 ? 0 : found / rows.length, mrr };
	};
	const modes = {
		words: result("words"),
		meaning: result("meaning"),
		both: result("both"),
	};
	return {
		at: now(),
		questions: rows.length,
		k: EVALUATION.k,
		minQuestions: EVALUATION.minQuestions,
		minGainPoints: EVALUATION.minGainPoints,
		meaning,
		modes,
		rows,
		advice: adviceOf(rows.length, modes.words, modes.both),
	};
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
