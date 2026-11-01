import { hoverTime, iso } from "@nightshift/client";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import type { ReactNode } from "react";

/**
 * A moment on the viewer's clock. The text is local. Hover shows the same
 * moment in UTC, the schedule's clock when that zone is not the viewer's,
 * and the computer when a schedule names one.
 */
export function LocalTime({
	at,
	children,
	zone,
	device,
	className,
}: {
	at: number;
	children: ReactNode;
	/** The schedule's clock, when it is not this computer's. */
	zone?: string;
	/** The computer a schedule runs on. */
	device?: string | null;
	className?: string;
}) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={<time dateTime={iso(at)} className={className} />}
			>
				{children}
			</TooltipTrigger>
			<TooltipContent>{hoverTime(at, { zone, device })}</TooltipContent>
		</Tooltip>
	);
}
