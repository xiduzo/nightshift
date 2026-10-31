import type { EnginePayloads } from "./events";

/**
 * What a score means: the one place that reads a `Scored` event's name,
 * value and who scored. The run state, the run metrics, the landed facts,
 * the Gates tab and the export to monitoring read a score through here.
 *
 * - `gate_decision`: a Gate was answered, on the Gate's step. `label` is
 *   the option it took, `by` who chose it: a person, or its deadline.
 * - `pr_merged`, `pr_closed`, `reverted_within_7d`: what became of the
 *   pull request the run opened. Reserved: nothing writes them yet
 *   (next phase 5.5, a kit's GitHub webhook).
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

/** A `Scored` event as a run score. */
export function runScore(e: {
	stepId: string | null;
	at: number;
	payload: EnginePayloads["Scored"];
}): RunScore {
	return {
		score: e.payload.score,
		value: e.payload.value,
		label: e.payload.label,
		stepId: e.stepId,
		at: e.at,
		by: answeredBy(e.payload),
	};
}
