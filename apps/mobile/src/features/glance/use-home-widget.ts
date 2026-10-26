import {
	createGateQueries,
	createRunQueries,
	GLANCE_RUNS,
	glanceSnapshot,
} from "@nightshift/client";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { useHostQueries } from "@/features/host";
import { updateGlance } from "./update-glance";

/**
 * Keeps the home screen widget up to date while the app runs: each time
 * the inbox or the runs refresh, the widget shows the new count and runs.
 */
export function useHomeWidget(): void {
	const gateQueries = useHostQueries(createGateQueries);
	const runQueries = useHostQueries(createRunQueries);
	const gates = useQuery(gateQueries.open());
	const runs = useQuery(runQueries.latest(GLANCE_RUNS));

	useEffect(() => {
		if (!gates.data || !runs.data) return;
		updateGlance(glanceSnapshot({ gates: gates.data, runs: runs.data }));
	}, [gates.data, runs.data]);
}
