import { runStatusLabel } from "@nightshift/client";
import { Badge } from "@nightshift/ui/components/badge";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { cn } from "@nightshift/ui/lib/utils";
import {
	CircleAlertIcon,
	CircleCheckIcon,
	CircleDashedIcon,
	CircleStopIcon,
	CircleXIcon,
	HourglassIcon,
	LoaderCircleIcon,
	type LucideIcon,
	MoonIcon,
} from "lucide-react";

import type { RunStatus, RunSummary } from "@/shared/api";

const STATUS: Record<RunStatus, { icon: LucideIcon; className: string }> = {
	running: {
		icon: LoaderCircleIcon,
		className:
			"border-status-running/40 bg-status-running/10 text-status-running [&>svg]:animate-spin motion-reduce:[&>svg]:animate-none",
	},
	waiting: {
		icon: HourglassIcon,
		className:
			"border-status-waiting/40 bg-status-waiting/10 text-status-waiting",
	},
	sleeping: {
		icon: MoonIcon,
		className:
			"border-status-sleeping/40 bg-status-sleeping/10 text-status-sleeping",
	},
	finished: {
		icon: CircleCheckIcon,
		className:
			"border-status-finished/40 bg-status-finished/10 text-status-finished",
	},
	stopped: {
		icon: CircleStopIcon,
		className:
			"border-status-stopped/40 bg-status-stopped/10 text-status-stopped",
	},
	failed: {
		icon: CircleXIcon,
		className: "border-status-failed/40 bg-status-failed/10 text-status-failed",
	},
	interrupted: {
		icon: CircleAlertIcon,
		className:
			"border-status-interrupted/40 bg-status-interrupted/10 text-status-interrupted",
	},
};

/** A run an End node ended with nothing to do: finished, but quiet. */
const NOTHING_TO_DO = {
	icon: CircleDashedIcon,
	className: "border-border bg-muted text-muted-foreground",
};

/** The icon, colour and label of a status, "Nothing to do" included. */
function statusLook(status: RunStatus, result: RunSummary["result"]) {
	const nothing = status === "finished" && result === "nothing-to-do";
	return {
		...(nothing ? NOTHING_TO_DO : STATUS[status]),
		label: nothing ? "Nothing to do" : runStatusLabel(status),
	};
}

export function RunStatusBadge({
	status,
	result = null,
	className,
}: {
	status: RunStatus;
	/** The result of the End node that ended the run: "Nothing to do" shows as such. */
	result?: RunSummary["result"];
	className?: string;
}) {
	const {
		icon: Icon,
		className: statusClassName,
		label,
	} = statusLook(status, result);
	return (
		<Badge variant="outline" className={cn(statusClassName, className)}>
			<Icon aria-hidden="true" />
			{label}
		</Badge>
	);
}

/**
 * A run's status as its icon alone, in the status colour, for a dense
 * list. The label shows on hover and reaches screen readers. `context`
 * goes before the label on hover, such as the flow and when it ran.
 */
export function RunStatusIcon({
	status,
	result = null,
	className,
	context,
}: {
	status: RunStatus;
	result?: RunSummary["result"];
	className?: string;
	context?: { before?: string; after?: string };
}) {
	const {
		icon: Icon,
		className: statusClassName,
		label,
	} = statusLook(status, result);
	const hover = [context?.before, label, context?.after]
		.filter(Boolean)
		.join(" · ");
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<span
						className={cn(
							"relative z-10 flex shrink-0 [&>svg]:size-4",
							statusClassName,
							// Keep the badge's text colour, drop its border and fill.
							"border-0 bg-transparent",
							className,
						)}
					/>
				}
			>
				<Icon aria-hidden="true" />
				<span className="sr-only">{hover}</span>
			</TooltipTrigger>
			<TooltipContent>{hover}</TooltipContent>
		</Tooltip>
	);
}
