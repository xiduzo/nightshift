import { type RunSummary, useRunPrefetch } from "@nightshift/client";
import { type Href, router } from "expo-router";
import { memo } from "react";

import { useSignedIn } from "@/features/host";
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
 * One run in a list: its status icon, its title, "Running · website",
 * and how long it has run, or when it started, kept current. Tap opens it.
 * It renders again only when its run or project name changes, or the
 * clock ticks.
 */
export const RunRow = memo(function RunRow({
	run,
	projectName,
}: {
	run: RunSummary;
	projectName: string | null;
}) {
	const now = useClock();
	const look = runStatusLook(run.status, run.result);
	const { value, valueLabel } = rowValue(run, now);
	const prefetch = useRunPrefetch(useSignedIn().host.orpc);
	return (
		<ListRow
			look={look}
			title={run.title}
			caption={[{ text: look.label, tone: look.tone }, projectName ?? ""]}
			value={value}
			valueLabel={valueLabel}
			href={runHref(run.id)}
			onPressIn={() => prefetch(run.id)}
			accessibilityLabel={runRowLabel(run, projectName, valueLabel)}
			accessibilityHint="Opens the run"
		/>
	);
});
