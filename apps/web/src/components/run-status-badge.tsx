import { Badge } from "@nightshift/ui/components/badge";
import { cn } from "@nightshift/ui/lib/utils";
import {
	CircleAlertIcon,
	CircleCheckIcon,
	CircleStopIcon,
	CircleXIcon,
	HourglassIcon,
	LoaderCircleIcon,
	type LucideIcon,
	MoonIcon,
} from "lucide-react";

import type { RunStatus } from "@/lib/api-types";

const STATUS: Record<
	RunStatus,
	{ label: string; icon: LucideIcon; className: string }
> = {
	running: {
		label: "Running",
		icon: LoaderCircleIcon,
		className:
			"border-status-running/40 bg-status-running/10 text-status-running [&>svg]:animate-spin motion-reduce:[&>svg]:animate-none",
	},
	waiting: {
		label: "Waiting for you",
		icon: HourglassIcon,
		className:
			"border-status-waiting/40 bg-status-waiting/10 text-status-waiting",
	},
	sleeping: {
		label: "Sleeping",
		icon: MoonIcon,
		className:
			"border-status-sleeping/40 bg-status-sleeping/10 text-status-sleeping",
	},
	finished: {
		label: "Finished",
		icon: CircleCheckIcon,
		className:
			"border-status-finished/40 bg-status-finished/10 text-status-finished",
	},
	stopped: {
		label: "Stopped",
		icon: CircleStopIcon,
		className:
			"border-status-stopped/40 bg-status-stopped/10 text-status-stopped",
	},
	failed: {
		label: "Failed",
		icon: CircleXIcon,
		className: "border-status-failed/40 bg-status-failed/10 text-status-failed",
	},
	interrupted: {
		label: "Interrupted",
		icon: CircleAlertIcon,
		className:
			"border-status-interrupted/40 bg-status-interrupted/10 text-status-interrupted",
	},
};

export function RunStatusBadge({
	status,
	className,
}: {
	status: RunStatus;
	className?: string;
}) {
	const { label, icon: Icon, className: statusClassName } = STATUS[status];
	return (
		<Badge variant="outline" className={cn(statusClassName, className)}>
			<Icon aria-hidden="true" />
			{label}
		</Badge>
	);
}
