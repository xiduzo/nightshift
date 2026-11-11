/**
 * "Was this run useful?": a person's answer on a finished run. Night Shift
 * logs it as the score `useful` on the run, 1 for yes and 0 for no. A later
 * answer replaces the one before. An older build wrote the same answer as
 * `pr_useful`, and an older Host still sends that name: both names are the
 * one answer. Flow health and every screen read it by this rule.
 */

/** The names of the answer: `useful`, and `pr_useful` of an older build. */
const USEFUL_NAMES: ReadonlySet<string> = new Set(["useful", "pr_useful"]);

/**
 * The last answer in a run's scores, oldest first: true for yes, false for
 * no. Null when nobody answered.
 */
export function usefulAnswer(
	scores: readonly { score: string; value: number }[] | undefined,
): boolean | null {
	let answer: boolean | null = null;
	for (const { score, value } of scores ?? []) {
		if (USEFUL_NAMES.has(score)) answer = value > 0;
	}
	return answer;
}
