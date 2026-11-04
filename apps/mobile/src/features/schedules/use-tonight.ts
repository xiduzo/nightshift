import {
	createDeviceQueries,
	createFlowQueries,
	knownComputers,
} from "@nightshift/client";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { useHostQueries } from "@/features/host";
import { useWhileFocused } from "@/shared/refresh";
import { offlineNotices, tonightEntries } from "./tonight";
import { usePendingPauses, useSchedulePlan } from "./use-schedule-plan";

/**
 * What runs tonight over the active Space: the schedules of the next 24
 * hours with the computer each runs on, and the notices for a computer
 * that is offline. The computers follow the Host while the screen has
 * focus. `now` comes from the screen's clock.
 */
export function useTonight(now: number) {
	const { plan, entries, error, loading, refetch } = useSchedulePlan(now);
	const pending = usePendingPauses();
	const deviceQueries = useHostQueries(createDeviceQueries);
	const focused = useWhileFocused();
	const space = useQuery({ ...deviceQueries.spaceLive(), ...focused });
	const overview = useQuery({ ...deviceQueries.overview(), ...focused });
	const flowQueries = useHostQueries(createFlowQueries);
	const projectIds = [...new Set(plan.soon.map((entry) => entry.projectId))];
	const flows = useQueries({
		queries: projectIds.map((projectId) => ({
			...flowQueries.list(projectId),
			...focused,
		})),
		combine: (results) => results.map((result) => result.data),
	});
	const projectKey = projectIds.join();
	// biome-ignore lint/correctness/useExhaustiveDependencies: projectKey stands for projectIds.
	const flowDevices = useMemo(() => {
		const ids = new Map<string, readonly string[]>();
		projectIds.forEach((projectId, index) => {
			for (const flow of flows[index] ?? []) {
				ids.set(`${projectId}:${flow.name}`, flow.devices.ids);
			}
		});
		return (projectId: string, flow: string) =>
			ids.get(`${projectId}:${flow}`) ?? [];
	}, [projectKey, flows]);
	const tonight = useMemo(
		() =>
			tonightEntries(
				plan.soon,
				knownComputers(overview.data, space.data),
				flowDevices,
				overview.data?.thisComputer?.name ?? null,
				now,
				pending,
			),
		[plan.soon, overview.data, space.data, flowDevices, now, pending],
	);
	return {
		entries: tonight,
		notices: useMemo(() => offlineNotices(tonight, now), [tonight, now]),
		/** Some schedules, in any project of the Space. */
		any: entries.length > 0,
		error,
		loading,
		refetch: () =>
			Promise.allSettled([refetch(), space.refetch(), overview.refetch()]),
	};
}

export type Tonight = ReturnType<typeof useTonight>;
