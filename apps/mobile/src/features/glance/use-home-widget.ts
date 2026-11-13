import {
	createDashboardQueries,
	createGateQueries,
	glanceLooks,
	glanceSnapshot,
} from "@nightshift/client";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { useHostQueries } from "@/features/host";
import { formatTime } from "@/shared/format";
import { updateGlance } from "./update-glance";

/**
 * Keeps the home screen widget up to date while the app runs: each time
 * the Gates or the watch over the flows refresh, the widget shows what
 * needs you now. The flows wait for nothing: without them the widget
 * shows the Gates.
 */
export function useHomeWidget(): void {
	const gateQueries = useHostQueries(createGateQueries);
	const dashboard = useHostQueries(createDashboardQueries);
	const gates = useQuery(gateQueries.open());
	const summary = useQuery({
		...dashboard.summary({ everySpace: true }),
		meta: { quietRefetchErrors: true },
	});
	const watch = summary.data?.watch;

	useEffect(() => {
		if (!gates.data) return;
		updateGlance(
			glanceSnapshot({
				gates: gates.data,
				looks: glanceLooks(watch),
				time: formatTime,
			}),
		);
	}, [gates.data, watch]);
}
