import { Badge } from "@nightshift/ui/components/badge";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { cn } from "@nightshift/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { spaceQueries } from "@/features/spaces";
import { formatRelative, hoverTime, useNow } from "@/shared/format";
import { type Machine, type SpaceMachines, spaceMachines } from "./machines";
import { deviceQueries } from "./queries";
import { spaceView } from "./space-view";

/** The computers of the active Space, with whether each is online now. Null while it loads. */
export function useSpaceMachines(): SpaceMachines | null {
	const overview = useQuery(deviceQueries.overviewLive());
	const devices = useQuery(deviceQueries.spaceLive());
	const spaces = useQuery(spaceQueries.list());
	const space = spaces.data?.spaces.find((s) => s.id === spaces.data?.active);
	return useMemo(
		() =>
			space && overview.data && devices.data
				? spaceMachines(
						spaceView({
							spaceId: space.id,
							personal: space.personal,
							thisComputer: overview.data.thisComputer,
							paired: overview.data.devices,
							devices: devices.data,
						}),
					)
				: null,
		[space, overview.data, devices.data],
	);
}

/** How a computer is now, in one sentence. */
function statusLine(machine: Machine, now: number): string {
	if (machine.thisDevice) return "This computer. Online now.";
	if (machine.online) return "Online now.";
	if (machine.online === null)
		return "Night Shift cannot tell if it is online.";
	if (machine.lastSeenAt) {
		return `Offline. Last seen ${formatRelative(machine.lastSeenAt, now)}. ${hoverTime(machine.lastSeenAt)}.`;
	}
	return "Offline.";
}

/** A computer's name with a dot: green when it is online, grey when not. */
export function MachineBadge({
	machine,
	label,
	className,
}: {
	machine: Machine;
	/** What it does for the run, before its status in the tooltip. */
	label?: string;
	className?: string;
}) {
	const now = useNow(30_000);
	const online = machine.online;
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Badge
						variant="outline"
						className={cn("shrink-0 font-normal", className)}
					/>
				}
			>
				<span
					aria-hidden="true"
					className={cn(
						"size-2 rounded-full",
						online
							? "bg-status-finished"
							: online === false
								? "bg-status-failed"
								: "bg-muted-foreground/50",
					)}
				/>
				{machine.name}
				<span className="sr-only">
					,{" "}
					{online ? "online" : online === false ? "offline" : "status unknown"}
				</span>
			</TooltipTrigger>
			<TooltipContent>
				{label ? `${label} ` : null}
				{statusLine(machine, now)}
			</TooltipContent>
		</Tooltip>
	);
}
