import type { OutcomeColor } from "@nightshift/flows";
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

type ColorStyle = Pick<Style, "badge" | "text" | "color">;

/** The look of each outcome colour. Literal classes, so Tailwind finds them. */
export const OUTCOME_COLOR_STYLE: Record<OutcomeColor, ColorStyle> = {
	red: {
		badge: "border-outcome-red/40 bg-outcome-red/10 text-outcome-red",
		text: "text-outcome-red",
		color: "var(--outcome-red)",
	},
	orange: {
		badge: "border-outcome-orange/40 bg-outcome-orange/10 text-outcome-orange",
		text: "text-outcome-orange",
		color: "var(--outcome-orange)",
	},
	amber: {
		badge: "border-outcome-amber/40 bg-outcome-amber/10 text-outcome-amber",
		text: "text-outcome-amber",
		color: "var(--outcome-amber)",
	},
	yellow: {
		badge: "border-outcome-yellow/40 bg-outcome-yellow/10 text-outcome-yellow",
		text: "text-outcome-yellow",
		color: "var(--outcome-yellow)",
	},
	lime: {
		badge: "border-outcome-lime/40 bg-outcome-lime/10 text-outcome-lime",
		text: "text-outcome-lime",
		color: "var(--outcome-lime)",
	},
	green: {
		badge: "border-outcome-green/40 bg-outcome-green/10 text-outcome-green",
		text: "text-outcome-green",
		color: "var(--outcome-green)",
	},
	teal: {
		badge: "border-outcome-teal/40 bg-outcome-teal/10 text-outcome-teal",
		text: "text-outcome-teal",
		color: "var(--outcome-teal)",
	},
	cyan: {
		badge: "border-outcome-cyan/40 bg-outcome-cyan/10 text-outcome-cyan",
		text: "text-outcome-cyan",
		color: "var(--outcome-cyan)",
	},
	sky: {
		badge: "border-outcome-sky/40 bg-outcome-sky/10 text-outcome-sky",
		text: "text-outcome-sky",
		color: "var(--outcome-sky)",
	},
	blue: {
		badge: "border-outcome-blue/40 bg-outcome-blue/10 text-outcome-blue",
		text: "text-outcome-blue",
		color: "var(--outcome-blue)",
	},
	indigo: {
		badge: "border-outcome-indigo/40 bg-outcome-indigo/10 text-outcome-indigo",
		text: "text-outcome-indigo",
		color: "var(--outcome-indigo)",
	},
	violet: {
		badge: "border-outcome-violet/40 bg-outcome-violet/10 text-outcome-violet",
		text: "text-outcome-violet",
		color: "var(--outcome-violet)",
	},
	pink: {
		badge: "border-outcome-pink/40 bg-outcome-pink/10 text-outcome-pink",
		text: "text-outcome-pink",
		color: "var(--outcome-pink)",
	},
	gray: {
		badge: "border-outcome-gray/40 bg-outcome-gray/10 text-outcome-gray",
		text: "text-outcome-gray",
		color: "var(--outcome-gray)",
	},
};

/**
 * The colour an outcome takes when its node sets none, from words in its
 * name: `failed` and `tests-failed` are red, `busy` amber, `none` gray.
 * The first list with a match wins.
 */
const NAMED_COLORS: [OutcomeColor, readonly string[]][] = [
	[
		"red",
		[
			"fail",
			"failed",
			"failure",
			"error",
			"errors",
			"broken",
			"crashed",
			"killed",
			"rejected",
			"denied",
			"invalid",
		],
	],
	[
		"amber",
		[
			"needs-input",
			"busy",
			"waiting",
			"blocked",
			"retry",
			"timeout",
			"halted",
			"interrupted",
			"terminated",
		],
	],
	[
		"gray",
		["none", "other", "empty", "skip", "skipped", "stopped", "cancelled"],
	],
	[
		"green",
		[
			"pass",
			"passed",
			"success",
			"succeeded",
			"ok",
			"done",
			"approved",
			"accepted",
			"merged",
			"valid",
			"yes",
		],
	],
];

export function defaultOutcomeColor(outcome: Outcome): OutcomeColor {
	const words = [outcome, ...outcome.split("-")];
	for (const [color, names] of NAMED_COLORS) {
		if (words.some((word) => names.includes(word))) return color;
	}
	return "cyan";
}

/** The colour an outcome shows: its own, else one from its name. */
export function resolveOutcomeColor(
	outcome: Outcome,
	color?: OutcomeColor,
): OutcomeColor {
	return color ?? defaultOutcomeColor(outcome);
}

function outcomeIcon(outcome: Outcome): LucideIcon {
	return outcome === "pass" || outcome === "fail" || outcome === "needs-input"
		? KNOWN_STATES[outcome].icon
		: CircleDotIcon;
}

function isKnown(state: string): state is keyof typeof KNOWN_STATES {
	return Object.hasOwn(KNOWN_STATES, state);
}

/** The look of a step state or an outcome. A Decision label or Gate choice shows its own name. */
export function stepStateStyle(state: StepState): Style {
	if (isKnown(state)) return KNOWN_STATES[state];
	return { ...outcomeStyle(state), label: state };
}

/**
 * The look of an outcome, for handles, edges and arrowheads: the colour its
 * node gives it, else one from its name.
 */
export function outcomeStyle(
	outcome: Outcome,
	color?: OutcomeColor,
): Omit<Style, "label"> {
	return {
		icon: outcomeIcon(outcome),
		...OUTCOME_COLOR_STYLE[resolveOutcomeColor(outcome, color)],
	};
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
