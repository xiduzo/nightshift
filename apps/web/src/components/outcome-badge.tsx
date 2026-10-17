import { Badge } from "@nightshift/ui/components/badge";
import { cn } from "@nightshift/ui/lib/utils";
import {
	BanIcon,
	CircleAlertIcon,
	CircleCheckIcon,
	CircleDotIcon,
	CircleStopIcon,
	CircleXIcon,
	HourglassIcon,
	LoaderCircleIcon,
	type LucideIcon,
	MessageCircleQuestionIcon,
	MoonIcon,
	OctagonPauseIcon,
	TriangleAlertIcon,
} from "lucide-react";

import type {
	ItemState,
	Outcome,
	RunStatus,
	StepOutcome,
	StepSummary,
} from "@/lib/api-types";

/**
 * A step that has not ended yet has no outcome: it is running, or, for a
 * Gate, waiting for a person.
 */
export type StepState = StepOutcome | "running" | "waiting" | "sleeping";

type Style = {
	label: string;
	icon: LucideIcon;
	/** Badge classes: border, tint, text. */
	badge: string;
	/** Text color only, for icons and labels. */
	text: string;
	/** CSS color for SVG strokes and inline styles. */
	color: string;
};

/** The states with a fixed look. Any other outcome is a Decision label or a Gate choice. */
const KNOWN_STATES = {
	pass: {
		label: "Pass",
		icon: CircleCheckIcon,
		badge: "border-outcome-pass/40 bg-outcome-pass/10 text-outcome-pass",
		text: "text-outcome-pass",
		color: "var(--outcome-pass)",
	},
	fail: {
		label: "Fail",
		icon: CircleXIcon,
		badge: "border-outcome-fail/40 bg-outcome-fail/10 text-outcome-fail",
		text: "text-outcome-fail",
		color: "var(--outcome-fail)",
	},
	"needs-input": {
		label: "Needs input",
		icon: MessageCircleQuestionIcon,
		badge:
			"border-outcome-needs-input/40 bg-outcome-needs-input/10 text-outcome-needs-input",
		text: "text-outcome-needs-input",
		color: "var(--outcome-needs-input)",
	},
	error: {
		label: "Error",
		icon: TriangleAlertIcon,
		badge: "border-status-failed/40 bg-status-failed/10 text-status-failed",
		text: "text-status-failed",
		color: "var(--status-failed)",
	},
	stopped: {
		label: "Stopped",
		icon: CircleStopIcon,
		badge: "border-status-stopped/40 bg-status-stopped/10 text-status-stopped",
		text: "text-status-stopped",
		color: "var(--status-stopped)",
	},
	interrupted: {
		label: "Interrupted",
		icon: CircleAlertIcon,
		badge:
			"border-status-interrupted/40 bg-status-interrupted/10 text-status-interrupted",
		text: "text-status-interrupted",
		color: "var(--status-interrupted)",
	},
	running: {
		label: "Running",
		icon: LoaderCircleIcon,
		badge:
			"border-status-running/40 bg-status-running/10 text-status-running [&>svg]:animate-spin motion-reduce:[&>svg]:animate-none",
		text: "text-status-running",
		color: "var(--status-running)",
	},
	waiting: {
		label: "Waiting for you",
		icon: HourglassIcon,
		badge: "border-status-waiting/40 bg-status-waiting/10 text-status-waiting",
		text: "text-status-waiting",
		color: "var(--status-waiting)",
	},
	sleeping: {
		label: "Sleeping",
		icon: MoonIcon,
		badge:
			"border-status-sleeping/40 bg-status-sleeping/10 text-status-sleeping",
		text: "text-status-sleeping",
		color: "var(--status-sleeping)",
	},
} satisfies Record<string, Style>;

/** The colour family of an outcome. Edges and arrowheads come in these. */
export type OutcomeTone = "pass" | "fail" | "needs-input" | "label";
export const OUTCOME_TONES: OutcomeTone[] = [
	"pass",
	"fail",
	"needs-input",
	"label",
];

export function outcomeTone(outcome: Outcome): OutcomeTone {
	return outcome === "pass" || outcome === "fail" || outcome === "needs-input"
		? outcome
		: "label";
}

const TONE_STYLE: Record<OutcomeTone, Omit<Style, "label">> = {
	pass: KNOWN_STATES.pass,
	fail: KNOWN_STATES.fail,
	"needs-input": KNOWN_STATES["needs-input"],
	label: {
		icon: CircleDotIcon,
		badge: "border-outcome-label/40 bg-outcome-label/10 text-outcome-label",
		text: "text-outcome-label",
		color: "var(--outcome-label)",
	},
};

function isKnown(state: string): state is keyof typeof KNOWN_STATES {
	return Object.hasOwn(KNOWN_STATES, state);
}

/** The look of a step state or an outcome. A Decision label or Gate choice shows its own name. */
export function stepStateStyle(state: StepState): Style {
	if (isKnown(state)) return KNOWN_STATES[state];
	return { ...TONE_STYLE.label, label: state };
}

/** The colour of an outcome, for handles, edges and arrowheads. */
export function outcomeStyle(outcome: Outcome): Omit<Style, "label"> {
	return TONE_STYLE[outcomeTone(outcome)];
}

/**
 * What a step shows: its outcome, else running, or waiting for an open Gate.
 * In a sleeping run, the step that has not ended sleeps with it (a Call
 * step keeps running: one of the steps it called sleeps).
 */
export function stepState(
	step: Pick<StepSummary, "outcome" | "nodeType" | "gate">,
	runStatus?: RunStatus,
): StepState {
	if (step.outcome !== null) return step.outcome;
	if (step.gate !== null) return "waiting";
	if (runStatus === "sleeping" && step.nodeType !== "call") {
		return "sleeping";
	}
	return "running";
}

/** The outcome of an edge, shown as its label. */
export function outcomeLabel(outcome: Outcome): string {
	return isKnown(outcome) ? KNOWN_STATES[outcome].label.toLowerCase() : outcome;
}

export function OutcomeBadge({
	state,
	className,
}: {
	state: StepState;
	className?: string;
}) {
	const { label, icon: Icon, badge } = stepStateStyle(state);
	return (
		<Badge variant="outline" className={cn(badge, className)}>
			<Icon aria-hidden="true" />
			{label}
		</Badge>
	);
}

const ITEM_STATES: Record<ItemState, Style> = {
	done: { ...KNOWN_STATES.pass, label: "Done" },
	failed: { ...KNOWN_STATES.fail, label: "Failed" },
	blocked: {
		label: "Blocked",
		icon: BanIcon,
		badge: "border-status-stopped/40 bg-status-stopped/10 text-status-stopped",
		text: "text-status-stopped",
		color: "var(--status-stopped)",
	},
	halted: {
		label: "Halted",
		icon: OctagonPauseIcon,
		badge:
			"border-status-interrupted/40 bg-status-interrupted/10 text-status-interrupted",
		text: "text-status-interrupted",
		color: "var(--status-interrupted)",
	},
	running: KNOWN_STATES.running,
};

export function itemStateStyle(state: ItemState): Style {
	return ITEM_STATES[state];
}

/** The state of one item of a Call step. */
export function ItemStateBadge({
	state,
	className,
}: {
	state: ItemState;
	className?: string;
}) {
	const { label, icon: Icon, badge } = ITEM_STATES[state];
	return (
		<Badge variant="outline" className={cn(badge, className)}>
			<Icon aria-hidden="true" />
			{label}
		</Badge>
	);
}
