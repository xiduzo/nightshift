import {
	deadlineSoon,
	type OpenGate,
	URGENCY_LABEL,
	urgencyOf,
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
 * "project · flow", its title, why you decide on one line, and when it
 * needs an answer ("by 12:00") or else how long it waited. Under that, in
 * small words: a deadline in the next hour ("Picks keep in 12 min"), why
 * a Gate does not wait for you ("Answer on its way"), "Now" for a Gate
 * that needs you now (left out where the screen says it already:
 * `urgency={false}`), and its choices. A Gate that needs you shows the
 * hand in the waiting tone (a screen reader hears "Needs you"). A
 * pull-request icon when the Gate links one. Tap opens it. The row keeps
 * its times current itself, so the screen does not re-render for them.
 * `overline` replaces "project · flow" where the screen says it already,
 * or hides it (null). It renders again only when its Gate changes, or the
 * clock ticks.
 */
export const GateRow = memo(function GateRow({
	gate,
	overline,
	urgency = true,
}: {
	gate: OpenGate;
	overline?: string | null;
	/** Show "Now" on a Gate that needs you now. */
	urgency?: boolean;
}) {
	const now = useClock();
	const row = gateRowText(gate, now);
	const soon = deadlineSoon(gate.deadline, now, gate.form);
	const look = gateLook(gate);
	const needsYou = look === NEEDS_YOU;
	const urgent = urgency && urgencyOf(gate) === "now";
	// The Gate itself is in the list of open Gates already: the steps of its run are not.
	const prefetch = useRunPrefetch(useSignedIn().host.orpc);
	const small = [
		...(urgent ? [{ text: URGENCY_LABEL.now, tone: "waiting" as const }] : []),
		...(soon ? [{ text: soon, tone: "waiting" as const }] : []),
		...(needsYou ? [] : [{ text: look.label, tone: look.tone }]),
		row.choices,
	];
	return (
		<ListRow
			look={look}
			icon={row.pullRequest ? GitPullRequest : undefined}
			overline={overline === undefined ? row.overline : (overline ?? undefined)}
			title={row.title}
			caption={row.situation || small}
			detail={row.situation ? small : undefined}
			value={row.due ?? row.waited}
			valueLabel={row.due ? `answer ${row.due}` : `waited ${row.waited}`}
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
