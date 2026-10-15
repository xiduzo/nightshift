import { Badge } from "@nightshift/ui/components/badge";
import { cn } from "@nightshift/ui/lib/utils";
import {
	CircleAlertIcon,
	CircleCheckIcon,
	CircleStopIcon,
	CircleXIcon,
	LoaderCircleIcon,
	type LucideIcon,
	MessageCircleQuestionIcon,
	TriangleAlertIcon,
} from "lucide-react";

import type { Outcome, StepOutcome } from "@/lib/api-types";

/** A step that has not ended yet has no outcome: it is running. */
export type StepState = StepOutcome | "running";

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

export const STEP_STATE: Record<StepState, Style> = {
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
};

/** The outcome of an edge, shown as its label. */
export function outcomeLabel(outcome: Outcome): string {
	return STEP_STATE[outcome].label.toLowerCase();
}

export function OutcomeBadge({
	state,
	className,
}: {
	state: StepState;
	className?: string;
}) {
	const { label, icon: Icon, badge } = STEP_STATE[state];
	return (
		<Badge variant="outline" className={cn(badge, className)}>
			<Icon aria-hidden="true" />
			{label}
		</Badge>
	);
}
