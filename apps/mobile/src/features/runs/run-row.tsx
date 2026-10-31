import type { RunSummary } from "@nightshift/client";
import { type Href, router } from "expo-router";

import { useClock } from "@/shared/clock";
import { ListRow } from "@/shared/list";
import { runStatusLook } from "@/shared/tone";
import { rowValue, runRowLabel } from "./runs-list";

/** The live view of a run. */
function runHref(runId: string): Href {
	return { pathname: "/runs/[runId]", params: { runId } };
}

/** Opens the live view of a run. */
export function openRun(runId: string): void {
	router.push(runHref(runId));
}

/**
 * One run in a ListGroup: its status icon, its title, "Running · website",
 * and how long it has run, or when it started, kept current. Tap opens it.
 */
export function RunRow({
	run,
	projectName,
}: {
	run: RunSummary;
	projectName: string | null;
}) {
	const now = useClock();
	const look = runStatusLook(run.status, run.result);
	const { value, valueLabel } = rowValue(run, now);
	return (
		<ListRow
			look={look}
			title={run.title}
			caption={[{ text: look.label, tone: look.tone }, projectName ?? ""]}
			value={value}
			valueLabel={valueLabel}
			href={runHref(run.id)}
			accessibilityLabel={runRowLabel(run, projectName, valueLabel)}
			accessibilityHint="Opens the run"
		/>
	);
}
