/**
 * "Was this run useful?" on a finished run: one tap, on the web and on the
 * phone. The answer is the score `useful` on the run. Flow health divides
 * what a flow's runs cost by the useful ones.
 */

import { isTestRun, usefulAnswer } from "@nightshift/engine/run-status";

import type { RunStatus } from "./types";

/** What the run page shows for Useful: nothing, the question, or the choice. */
export type UsefulView = "hidden" | "ask" | "yes" | "no";

/** The question on the run page. */
export const USEFUL_QUESTION = "Was this run useful?";

/** Why the question is there. One sentence, under 20 words. */
export const USEFUL_HINT =
	"Flow health uses your answers to show what a useful result costs.";

/** The question stays when the save did not land. */
export const USEFUL_ERROR = "Night Shift did not save that. Try again.";

const remembered = new Map<string, boolean>();

/** The choice this app already saved for a run. Null when it has not. */
export function rememberedUseful(runId: string): boolean | null {
	if (!remembered.has(runId)) return null;
	return remembered.get(runId) === true;
}

/** Keeps a choice so the page does not ask again before the run reads again. */
export function rememberUseful(runId: string, useful: boolean): void {
	remembered.set(runId, useful);
}

/**
 * The choice to show. A tap in this app wins. Else the last answer the
 * run's scores hold, under either name (`usefulAnswer`). Null when nobody
 * has answered.
 */
export function knownUseful(
	scores: readonly { score: string; value: number }[] | undefined,
	rememberedChoice: boolean | null,
): boolean | null {
	if (rememberedChoice !== null) return rememberedChoice;
	return usefulAnswer(scores);
}

/**
 * Only a finished run asks. Then the question, or Yes, or No. A test run
 * never asks: its result is a try, not one to count.
 */
export function usefulView(
	status: RunStatus,
	known: boolean | null,
	run: { test?: unknown },
): UsefulView {
	if (status !== "finished" || isTestRun(run)) return "hidden";
	if (known === null) return "ask";
	return known ? "yes" : "no";
}

/** The line after a tap: which choice they made. */
export function usefulLabel(view: "yes" | "no"): string {
	return view === "yes"
		? "You found this run useful."
		: "You did not find this run useful.";
}
