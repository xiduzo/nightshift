import {
	costLabel,
	flowLabel,
	hasEnded,
	isTestRun,
	type RunSummary,
	TEST_RUN_LABEL,
	tokensLabel,
	wall,
} from "@nightshift/client";

/** The lines of a run row without React Native: where it is from, and its time and cost. */

function clock(at: number): string {
	const shown = wall(at);
	return `${String(shown.hour).padStart(2, "0")}:${String(shown.minute).padStart(2, "0")}`;
}

/**
 * The line under a run's project and flow, after its status word. A run
 * on its way: since when. A run that waits: since when its oldest open
 * Gate waits. An ended run: when it ended, and its cost when known.
 */
export function runMeta(
	run: Pick<
		RunSummary,
		| "status"
		| "createdAt"
		| "endedAt"
		| "gates"
		| "costUsd"
		| "costMissing"
		| "costCalls"
		| "metrics"
	>,
): string {
	if (run.status === "waiting") {
		const open = run.gates
			.filter((gate) => gate.closedAt === null)
			.reduce<number | null>(
				(oldest, gate) =>
					oldest === null ? gate.openedAt : Math.min(oldest, gate.openedAt),
				null,
			);
		return `since ${clock(open ?? run.createdAt)}`;
	}
	if (!hasEnded(run.status)) return `since ${clock(run.createdAt)}`;
	return [
		run.endedAt !== null ? clock(run.endedAt) : null,
		tokensLabel(run.metrics?.tokens),
		costLabel(run),
	]
		.filter((part): part is string => part !== null)
		.join(" · ");
}

/**
 * The line under a run's title: "website · Feature factory", and
 * "· Test run" for a run started from the editor with pins or skips.
 */
export function runPlace(
	run: Pick<RunSummary, "flowName" | "test">,
	projectName: string | null,
): string {
	return [projectName, flowLabel(run), isTestRun(run) ? TEST_RUN_LABEL : null]
		.filter((part): part is string => part !== null && part !== "")
		.join(" · ");
}
