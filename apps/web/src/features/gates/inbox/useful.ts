/** What a digest row shows for Useful: nothing, the question, or the choice. */
export type UsefulView = "hidden" | "ask" | "yes" | "no";

/** Why the question is there. One sentence, under 20 words. */
export const USEFUL_HINT =
	"This helps Night Shift learn which runs are worth the cost.";

/** The question stays when the save did not land. */
export const USEFUL_ERROR = "Night Shift did not save that. Try again.";

const remembered = new Map<string, boolean>();

/** The choice this window already saved for a run. Null when it has not. */
export function rememberedUseful(runId: string): boolean | null {
	if (!remembered.has(runId)) return null;
	return remembered.get(runId) === true;
}

/** Keeps a choice so the row does not ask again after it leaves and comes back. */
export function rememberUseful(runId: string, useful: boolean): void {
	remembered.set(runId, useful);
}

/**
 * The choice to show. A tap in this window wins. Else a boolean `useful`
 * on the run, once the digest sends one. Null when nobody has answered.
 */
export function knownUseful(
	run: object,
	rememberedChoice: boolean | null,
): boolean | null {
	if (rememberedChoice !== null) return rememberedChoice;
	if ("useful" in run && typeof run.useful === "boolean") return run.useful;
	return null;
}

/** Hidden without a pull request. Otherwise the question, or Yes, or No. */
export function usefulView(
	run: { prUrl: string | null },
	known: boolean | null,
): UsefulView {
	if (!run.prUrl) return "hidden";
	if (known === null) return "ask";
	return known ? "yes" : "no";
}

/** The line after a tap: which choice they made. */
export function usefulLabel(view: "yes" | "no"): string {
	return view === "yes" ? "Useful: Yes" : "Useful: No";
}
