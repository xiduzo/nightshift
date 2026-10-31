import { type RunSummary, useRunPrefetch } from "@nightshift/client";
import { type Href, router } from "expo-router";
import { memo } from "react";

import { useSignedIn } from "@/features/host";
import { ListRow } from "@/shared/list";
import { runStatusLook } from "@/shared/tone";
import { runMeta, runPlace } from "./runs-list";

/** The live view of a run. */
function runHref(runId: string): Href {
	return { pathname: "/runs/[runId]", params: { runId } };
}

/** Opens the live view of a run. */
export function openRun(runId: string): void {
	router.push(runHref(runId));
}

/**
 * One run in a list: its status icon, its title, "website · Feature
 * factory", and "Running · since 06:40" or "Finished · 02:05 · $2.61".
 * Tap opens it. It renders again only when its run or project name
 * changes.
 */
export const RunRow = memo(function RunRow({
	run,
	projectName,
}: {
	run: RunSummary;
	projectName: string | null;
}) {
	const look = runStatusLook(run.status, run.result);
	const prefetch = useRunPrefetch(useSignedIn().host.orpc);
	return (
		<ListRow
			look={look}
			// The last line says the status: a screen reader hears it once.
			iconLabel=""
			title={run.title}
			caption={runPlace(run, projectName)}
			detail={[{ text: look.label, tone: look.tone }, runMeta(run)]}
			href={runHref(run.id)}
			onPressIn={() => prefetch(run.id)}
			accessibilityHint="Opens the run"
		/>
	);
});
