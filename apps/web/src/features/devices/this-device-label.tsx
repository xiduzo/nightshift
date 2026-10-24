import { platformName } from "@nightshift/client";
import { Badge } from "@nightshift/ui/components/badge";
import { SidebarGroupLabel } from "@nightshift/ui/components/sidebar";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { useQuery } from "@tanstack/react-query";
import { deviceQueries } from "./queries";

/**
 * The sidebar label of the group that is saved on the computer that serves
 * this app: its Device name, and "Host" when it is a Host. "This computer"
 * until the name is known, and for a person who does not own it.
 */
export function ThisDeviceLabel() {
	const overview = useQuery({
		...deviceQueries.overview(),
		staleTime: 60_000,
		meta: { quietErrors: true },
	});
	const computer = overview.data?.thisComputer ?? null;
	const name = computer?.name || "This computer";
	const host = computer?.host.enabled ?? false;

	return (
		<Tooltip>
			<TooltipTrigger render={<SidebarGroupLabel className="gap-2" />}>
				<span className="truncate">{name}</span>
				{host ? (
					<Badge variant="outline" className="h-4 px-1.5 text-[10px]">
						Host
					</Badge>
				) : null}
			</TooltipTrigger>
			<TooltipContent side="right">
				{computer
					? `${computer.name}, ${platformName(computer.platform)}${host ? ", a Host" : ""}`
					: name}
			</TooltipContent>
		</Tooltip>
	);
}
