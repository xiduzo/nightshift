import { type Href, router } from "expo-router";

/** The live view of a run. */
function runHref(runId: string): Href {
	return { pathname: "/runs/[runId]", params: { runId } };
}

/** Opens the live view of a run. */
export function openRun(runId: string): void {
	router.push(runHref(runId));
}
