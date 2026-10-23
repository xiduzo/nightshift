import type { OpenGate } from "@nightshift/client";
import { GitPullRequest } from "lucide-react-native";

import { ListRow } from "@/shared/list";
import { gateLook } from "@/shared/tone";
import { gateRowText } from "./inbox-view";

/**
 * One open Gate, the same on Home, the Inbox, Search, a project and a run:
 * "project · flow", its question, its status word, choices and node, and
 * how long it waited. A pull-request icon when the Gate links one. Tap
 * opens it. `overline` replaces "project · flow" where the screen says it
 * already, or hides it (null).
 */
export function GateRow({
	gate,
	now,
	overline,
}: {
	gate: OpenGate;
	now: number;
	overline?: string | null;
}) {
	const row = gateRowText(gate, now);
	const look = gateLook(gate);
	return (
		<ListRow
			look={look}
			icon={row.pullRequest ? GitPullRequest : undefined}
			overline={overline === undefined ? row.overline : (overline ?? undefined)}
			title={row.title}
			caption={[
				{ text: look.label, tone: look.tone },
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
				gate.canAnswer && !gate.answerPending
					? "Opens the Gate to answer it"
					: "Opens the Gate"
			}
		/>
	);
}
