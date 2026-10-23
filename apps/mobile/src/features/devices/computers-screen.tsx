import { createDeviceQueries } from "@nightshift/client";
import { useQuery } from "@tanstack/react-query";

import { useHostQueries } from "@/features/host";
import { LargeTitleHeader } from "@/shared/header";
import { Screen } from "@/shared/page";
import { ComputersCard } from "./computers-card";

/** Your computers and whether each can run a flow now. A sheet from Home. */
export function ComputersScreen() {
	const devices = useHostQueries(createDeviceQueries);
	const overview = useQuery(devices.overview());

	return (
		<Screen onRefresh={() => overview.refetch()}>
			<LargeTitleHeader
				compact
				title="Computers"
				summary="A flow runs on a computer that is online."
			/>
			<ComputersCard
				overview={overview.data}
				error={overview.error}
				now={overview.dataUpdatedAt || Date.now()}
			/>
		</Screen>
	);
}
