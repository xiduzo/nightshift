/** What the run page shows for Useful: nothing, the question, or the choice. */
export type UsefulView = "hidden" | "ask" | "yes" | "no";

/** The question on the run page. */
export const USEFUL_QUESTION = "Was this pull request useful?";

/** Why the question is there. One sentence, under 20 words. */
export const USEFUL_HINT =
	"This helps Night Shift learn which runs are worth the cost.";

/** The question stays when the save did not land. */
export const USEFUL_ERROR = "Night Shift did not save that. Try again.";

/** The score a person's answer writes on the run. */
const USEFUL_SCORE = "pr_useful";

const remembered = new Map<string, boolean>();

/** The choice this window already saved for a run. Null when it has not. */
export function rememberedUseful(runId: string): boolean | null {
	if (!remembered.has(runId)) return null;
	return remembered.get(runId) === true;
}

/** Keeps a choice so the page does not ask again before the run reads again. */
export function rememberUseful(runId: string, useful: boolean): void {
	remembered.set(runId, useful);
}

/**
 * The choice to show. A tap in this window wins. Else the last answer the
 * run's scores hold. Null when nobody has answered.
 */
export function knownUseful(
	scores: readonly { score: string; value: number }[] | undefined,
	rememberedChoice: boolean | null,
): boolean | null {
	if (rememberedChoice !== null) return rememberedChoice;
	const answers = (scores ?? []).filter((one) => one.score === USEFUL_SCORE);
	const last = answers[answers.length - 1];
	return last ? last.value > 0 : null;
}

/** Hidden without a pull request. Otherwise the question, or Yes, or No. */
export function usefulView(
	prUrl: string | null | undefined,
	known: boolean | null,
): UsefulView {
	if (!prUrl) return "hidden";
	if (known === null) return "ask";
	return known ? "yes" : "no";
}

/** The line after a tap: which choice they made. */
export function usefulLabel(view: "yes" | "no"): string {
	return view === "yes"
		? "You found this pull request useful"
		: "You found this pull request not useful";
}
