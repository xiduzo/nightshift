import type { JsonValue } from "@nightshift/flows";

import type { EnginePayloads, ScoreName } from "./events";

/**
 * What a score means: the one place that reads a `Scored` event's name,
 * value and who scored. The run state, the run metrics, the landed facts,
 * the Gates tab and the export to monitoring read a score through here.
 *
 * - `gate_decision`: a Gate was answered, on the Gate's step. `label` is
 *   the option it took, `by` who chose it: a person, or its deadline.
 * - `useful`: a person said whether the run was useful ("Was this run
 *   useful?" on a finished run). `value` is 1 for yes and 0 for no. On the
 *   run. A later answer replaces the one before (`usefulAnswer`). An older
 *   build wrote it as `pr_useful`: `runScore` reads that name as `useful`,
 *   so every reader sees one name.
 * - `pr_merged`, `pr_closed`, `reverted_within_7d`: the optional scorer
 *   for code, what became of the pull request the run opened. A GitHub
 *   webhook of a schedule with `scorePullRequests` writes them, and so does
 *   the morning check of `gh pr view`. On the run, not on a step.
 *   `pr_merged`'s label is the merge commit's sha, a revert's the commit or
 *   the pull request that reverted it.
 * - Any other name: a Command, an Agent or a Value step wrote it in its
 *   data, as `{"scores": {"replicated": 1}}` (`flowScores`): a flow metric
 *   (Q32). On that step, after its `StepEnded`, with no label. A try of a
 *   cascade that climbs on scores nothing. The flow chooses the name and
 *   what the value means. A name is letters, digits, `_` and `-`, at most 64
 *   characters, and not one of the names above. The value is a number of
 *   0 or more: the export adds scores up as a counter.
 *
 * `value` is 1 for a fact that happened. The names are an open list: a
 * score of a newer Walker passes through with its name, and means nothing
 * more here.
 */

/** Who chose a Gate's option. */
export type AnsweredBy = "person" | "deadline";

/** One `Scored` of a run, as every reader reads it. */
export type RunScore = {
	/** What it scores. An open list: a newer Walker may write a name this build does not know. */
	score: string;
	value: number;
	label: string | null;
	/** The step it is on: a Gate's. Null for a score of the run. */
	stepId: string | null;
	at: number;
	/** A Gate's answer: who chose the option. Null for any other score. */
	by: AnsweredBy | null;
};

/** Who chose a Gate's option, when the score is a Gate's answer. Else null. */
export function answeredBy(
	payload: EnginePayloads["Scored"],
): AnsweredBy | null {
	return payload.score === "gate_decision" ? (payload.by ?? null) : null;
}

/** The older name of the useful answer. Older logs keep it: it is read as `useful`. */
const OLD_USEFUL: ScoreName = "pr_useful";

/** A `Scored` event as a run score. `pr_useful` reads as `useful`. */
export function runScore(e: {
	stepId: string | null;
	at: number;
	payload: EnginePayloads["Scored"];
}): RunScore {
	return {
		score: e.payload.score === OLD_USEFUL ? "useful" : e.payload.score,
		value: e.payload.value,
		label: e.payload.label,
		stepId: e.stepId,
		at: e.at,
		by: answeredBy(e.payload),
	};
}

/** The names Night Shift writes itself. A flow may not write them. */
const OWN_SCORES: ReadonlySet<string> = new Set<ScoreName>([
	"gate_decision",
	"useful",
	"pr_merged",
	"pr_closed",
	"reverted_within_7d",
	"pr_useful",
]);

/** The name of a score a flow writes: letters, digits, `_` and `-`. */
const FLOW_SCORE_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/** A score a step wrote in its data, to log as `Scored` on its step. */
export type FlowScore = { score: string; value: number };

/**
 * The scores in a step's data: its `scores` object, name to
 * number. An entry Night Shift cannot keep is left out, with a sentence
 * for the step's warning: a name Night Shift writes itself, a name that is
 * not letters, digits, `_` and `-` (at most 64), or a value that is not a
 * number of 0 or more. `scores` that is not an object is one refusal.
 */
export function flowScores(data: JsonValue | undefined): {
	scores: FlowScore[];
	refused: string[];
} {
	if (data === null || typeof data !== "object" || Array.isArray(data)) {
		return { scores: [], refused: [] };
	}
	const raw = data.scores;
	if (raw === undefined) return { scores: [], refused: [] };
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
		return {
			scores: [],
			refused: [
				'The step wrote "scores" that is not an object. Write names with numbers, such as {"scores": {"replicated": 1}}.',
			],
		};
	}
	const scores: FlowScore[] = [];
	const refused: string[] = [];
	for (const [score, value] of Object.entries(raw)) {
		if (OWN_SCORES.has(score)) {
			refused.push(
				`The step wrote the score "${score}". Night Shift keeps that name for itself. Choose another name.`,
			);
		} else if (!FLOW_SCORE_NAME.test(score)) {
			refused.push(
				`The step wrote the score "${score.slice(0, 80)}". Use letters, digits, _ and -, at most 64 characters.`,
			);
		} else if (
			typeof value !== "number" ||
			!Number.isFinite(value) ||
			value < 0
		) {
			refused.push(
				`The step wrote the score "${score}" without a number of 0 or more. Write a number, such as 1.`,
			);
		} else {
			scores.push({ score, value });
		}
	}
	return { scores, refused };
}
