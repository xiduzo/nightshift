/**
 * "Was this run useful?": a person's answer on a finished run. Night Shift
 * logs it as the score `useful` on the run, 1 for yes and 0 for no. A later
 * answer replaces the one before. Flow health and every screen read it by
 * this rule.
 */

/**
 * The last answer in a run's scores, oldest first: true for yes, false for
 * no. Null when nobody answered.
 */
export function usefulAnswer(
	scores: readonly { score: string; value: number }[] | undefined,
): boolean | null {
	let answer: boolean | null = null;
	for (const { score, value } of scores ?? []) {
		if (score === "useful") answer = value > 0;
	}
	return answer;
}
