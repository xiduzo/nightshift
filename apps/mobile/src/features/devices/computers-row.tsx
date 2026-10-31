import { createDeviceQueries } from "@nightshift/client";
import { useQuery } from "@tanstack/react-query";
import { Laptop } from "lucide-react-native";

import { useHostQueries } from "@/features/host";
import { ListRow } from "@/shared/list";
import { useWhileFocused } from "@/shared/refresh";
import { computersOf, onlineSummary } from "./computers";

/**
 * The row on Home that opens your computers: how many are online, in red
 * when one is offline. Until they load, where your flows run.
 */
export function ComputersRow() {
	const devices = useHostQueries(createDeviceQueries);
	const overview = useQuery({ ...devices.overview(), ...useWhileFocused() });
	const computers = overview.data ? computersOf(overview.data) : [];
	const offline = computers.some((computer) => !computer.online);
	return (
		<ListRow
			icon={Laptop}
			title="Computers"
			caption={
				computers.length > 0
					? [
							{
								text: onlineSummary(computers),
								tone: offline ? "failed" : "neutral",
							},
						]
					: "Where your flows run"
			}
			href="/computers"
			accessibilityHint="Shows which of your computers are online"
		/>
	);
}
