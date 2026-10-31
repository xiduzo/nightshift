import {
	deadlineSoon,
	type OpenGate,
	useRunPrefetch,
} from "@nightshift/client";
import { GitPullRequest } from "lucide-react-native";
import { memo } from "react";

import { useSignedIn } from "@/features/host";
import { useClock } from "@/shared/clock";
import { ListRow } from "@/shared/list";
import { gateLook, NEEDS_YOU } from "@/shared/tone";
import { gateRowText } from "./gate-list";

/**
 * One open Gate, the same on Watch, Needs you, Search, a project and a run:
 * "project · flow", its question, its choices and node, and how long it
 * waited. A Gate that needs you shows the hand in the waiting tone (a
 * screen reader hears "Needs you"); any other Gate says why in a word:
 * "Answer on its way", "Waits for another person". A deadline in the next
 * hour shows first: "Picks keep in 12 min". A pull-request icon when the
 * Gate links one. Tap opens it. The row keeps its times current itself,
 * so the screen does not re-render for them. `overline` replaces "project · flow" where the screen says it
 * already, or hides it (null). It renders again only when its Gate
 * changes, or the clock ticks.
 */
export const GateRow = memo(function GateRow({
	gate,
	overline,
}: {
	gate: OpenGate;
	overline?: string | null;
}) {
	const now = useClock();
	const row = gateRowText(gate, now);
	const soon = deadlineSoon(gate.deadline, now);
	const look = gateLook(gate);
	const needsYou = look === NEEDS_YOU;
	// The Gate itself is in the list of open Gates already: the steps of its run are not.
	const prefetch = useRunPrefetch(useSignedIn().host.orpc);
	return (
		<ListRow
			look={look}
			icon={row.pullRequest ? GitPullRequest : undefined}
			overline={overline === undefined ? row.overline : (overline ?? undefined)}
			title={row.title}
			caption={[
				...(soon ? [{ text: soon, tone: "waiting" as const }] : []),
				...(needsYou ? [] : [{ text: look.label, tone: look.tone }]),
				row.choices,
				{ text: row.nodeId, mono: true },
			]}
			value={row.waited}
			valueLabel={`waited ${row.waited}`}
			href={{
				pathname: "/gates/[runId]/[stepId]",
				params: { runId: gate.runId, stepId: gate.stepId },
			}}
			onPressIn={() => prefetch(gate.runId)}
			accessibilityHint={
				needsYou ? "Opens the Gate to answer it" : "Opens the Gate"
			}
		/>
	);
});
