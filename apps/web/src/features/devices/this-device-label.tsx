import { platformName } from "@nightshift/client";
import { SidebarGroupLabel } from "@nightshift/ui/components/sidebar";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { useQuery } from "@tanstack/react-query";
import { deviceIcon } from "./device-icon";
import { deviceQueries } from "./queries";

/**
 * The sidebar label of the group that is saved on the computer that serves
 * this app: its Device name and an icon. "This computer" until the name is
 * known, and for a person who does not own it.
 */
export function ThisDeviceLabel() {
	const overview = useQuery({
		...deviceQueries.overview(),
		staleTime: 60_000,
		meta: { quietErrors: true },
	});
	const computer = overview.data?.thisComputer ?? null;
	const name = computer?.name || "This computer";
	const Icon = deviceIcon(computer);

	return (
		<Tooltip>
			<TooltipTrigger render={<SidebarGroupLabel className="gap-2" />}>
				<Icon aria-hidden="true" />
				<span className="truncate">{name}</span>
			</TooltipTrigger>
			<TooltipContent side="right">
				{computer
					? `${computer.name}, ${platformName(computer.platform)}`
					: name}
			</TooltipContent>
		</Tooltip>
	);
}
