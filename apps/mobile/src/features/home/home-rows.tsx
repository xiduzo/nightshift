import { useRunPrefetch, waitedText } from "@nightshift/client";

import { useSignedIn } from "@/features/host";
import { formatTime } from "@/shared/format";
import { ListRow } from "@/shared/list";
import { runStatusLook } from "@/shared/tone";
import type { NightRun } from "./last-night";

/**
 * A run of the summary: its status, title, project and branch. A running
 * run shows how long it has been at work, an ended one when it started.
 */
export function NightRunRow({ run, now }: { run: NightRun; now: number }) {
	const look = runStatusLook(run.status);
	const running = run.status === "running";
	const prefetch = useRunPrefetch(useSignedIn().host.orpc);
	const value = running
		? waitedText(now - run.createdAt)
		: formatTime(run.createdAt);
	return (
		<ListRow
			look={look}
			title={run.title}
			caption={[
				{ text: look.label, tone: look.tone },
				run.group,
				{ text: run.branch, mono: true },
			]}
			detail={run.reason ?? undefined}
			value={value}
			valueLabel={running ? `at work for ${value}` : `started ${value}`}
			href={{ pathname: "/runs/[runId]", params: { runId: run.id } }}
			onPressIn={() => prefetch(run.id)}
			accessibilityHint="Opens the run"
		/>
	);
}
