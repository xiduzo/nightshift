import {
	costLabel,
	type RunStatus,
	type StepSummary,
	stepName,
	stepState,
	waitedText,
} from "@nightshift/client";

import { type Look, type StepKind, stepKind, stepLook } from "@/shared/tone";

/** One step of a StepTrail, ready to show. */
export type TrailItem = {
	id: string;
	/** What kind of step: its icon and word ("Agent"). */
	kind: StepKind;
	/** The node's name, in mono: "review", "Review (visit 2)". */
	label: string;
	/** How it ended, or that it runs or waits: the badge. */
	look: Look;
	/** What happened: the step's error, or a line the screen gives. */
	detail?: string;
	/** "4 min · $0.12", "Waiting 12 min". */
	meta?: string;
	/** An open Gate: the icon takes the waiting tone. */
	waiting?: boolean;
};

/**
 * A run's step as a StepTrail item: its kind, its name (with the visit),
 * its state, its error and "4 min · $0.12". `now` counts a step that has
 * not ended.
 */
export function trailItemOf(
	step: StepSummary,
	{
		labels,
		runStatus,
		now,
	}: {
		labels: ReadonlyMap<string, string>;
		runStatus?: RunStatus;
		now: number;
	},
): TrailItem {
	const state = stepState(step);
	const waiting = state === "waiting";
	const took = waitedText((step.endedAt ?? now) - step.startedAt);
	const cost = costLabel(step);
	const meta = waiting
		? `Waiting ${took}`
		: [took, cost].filter((part): part is string => part !== null).join(" · ");
	return {
		id: step.id,
		kind: stepKind(step),
		label: stepName(step, labels),
		look: stepLook(
			{ state, outcome: step.outcome, nodeType: step.nodeType },
			runStatus,
		),
		detail: step.error ?? undefined,
		meta,
		waiting,
	};
}

/** What a screen reader says for one step: "Agent step build, Pass, 4 min, $0.12". */
export function trailItemLabel(item: TrailItem): string {
	return [
		`${item.kind.label} step ${item.label}`,
		item.look.label,
		item.detail,
		item.meta?.replaceAll(" · ", ", "),
	]
		.filter((part): part is string => part !== undefined && part !== "")
		.join(", ");
}
