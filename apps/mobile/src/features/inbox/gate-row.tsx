import { deadlineSoon, type OpenGate } from "@nightshift/client";
import { GitPullRequest } from "lucide-react-native";

import { useClock } from "@/shared/clock";
import { ListRow } from "@/shared/list";
import { gateLook, NEEDS_YOU } from "@/shared/tone";
import { gateRowText } from "./inbox-view";

/**
 * One open Gate, the same on Home, the Inbox, Search, a project and a run:
 * "project · flow", its question, its choices and node, and how long it
 * waited. A Gate that needs you shows the hand in the waiting tone (a
 * screen reader hears "Needs you"); any other Gate says why in a word:
 * "Answer on its way", "Waits for another person". A deadline in the next
 * hour shows first: "Picks keep in 12 min". A pull-request icon when the
 * Gate links one. Tap opens it. The row keeps its times current itself,
 * so the screen does not re-render for them. `overline` replaces "project · flow" where the screen says it
 * already, or hides it (null).
 */
export function GateRow({
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
			accessibilityHint={
				needsYou ? "Opens the Gate to answer it" : "Opens the Gate"
			}
		/>
	);
}
