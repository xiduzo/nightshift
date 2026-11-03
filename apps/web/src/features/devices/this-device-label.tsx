import { platformName } from "@nightshift/client";
import { Badge } from "@nightshift/ui/components/badge";
import { DropdownMenuLabel } from "@nightshift/ui/components/dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import { deviceQueries } from "./queries";

/**
 * The label of the menu group that is saved on the computer that serves
 * this app: its Device name and platform, and "Host" when it is a Host.
 * "This computer" until the name is known, and for a person who does not
 * own it.
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
		<DropdownMenuLabel
			className="flex items-center gap-2"
			title={
				computer
					? `${computer.name}, ${platformName(computer.platform)}`
					: undefined
			}
		>
			<span className="truncate">{name}</span>
			{host ? (
				<Badge variant="outline" className="h-4 px-1.5 text-[10px]">
					Host
				</Badge>
			) : null}
		</DropdownMenuLabel>
	);
}
