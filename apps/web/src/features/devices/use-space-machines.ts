import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { spaceQueries } from "@/features/spaces";
import { type SpaceMachines, spaceMachines } from "./machines";
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
