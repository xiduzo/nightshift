import { Badge } from "@nightshift/ui/components/badge";
import { cn } from "@nightshift/ui/lib/utils";
import { MonitorIcon } from "lucide-react";

import type { RunSummary } from "@/shared/api";

/** The name of the device that runs a run, as people read it. */
export function walkerName(walker: RunSummary["walker"]): string {
	return walker.name ?? "another device";
}

/**
 * Where a run runs (its steps' Device, or a Walker), when it is not this
 * computer: a Badge with the device's name. Nothing for this computer.
 */
export function WalkerBadge({
	walker,
	className,
}: {
	walker: RunSummary["walker"];
	className?: string;
}) {
	if (walker.thisDevice) return null;
	return (
		<Badge
			variant="outline"
			className={cn("shrink-0 text-muted-foreground", className)}
		>
			<MonitorIcon aria-hidden="true" />
			<span className="sr-only">Runs on </span>
			{walkerName(walker)}
		</Badge>
	);
}
