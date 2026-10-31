import {
	createDeviceQueries,
	createFlowQueries,
	type FlowListItem,
	type KnownComputer,
	knownComputers,
	offlineNeeds,
} from "@nightshift/client";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { useHostQueries } from "@/features/host";
import { useWhileFocused } from "@/shared/refresh";

/** Each flow of a project that needs a computer that is offline now: its name → those computers. */
export type OfflineNeeds = ReadonlyMap<string, readonly string[]>;

/**
 * The flows of a project that cannot run all their steps now, because a
 * computer they name is offline. From three reads the phone has anyway:
 * the project's flows (with the computers they name), the Space's
 * computers and your own. The Space's computers follow the Host while the
 * screen has focus. Undefined until the flows and computers are known.
 */
export function useOfflineNeeds(
	projectId: string | undefined,
): OfflineNeeds | undefined {
	const flowQueries = useHostQueries(createFlowQueries);
	const deviceQueries = useHostQueries(createDeviceQueries);
	const whileFocused = useWhileFocused();
	const enabled = projectId !== undefined;
	const flows = useQuery({
		...flowQueries.list(projectId ?? ""),
		enabled,
		...whileFocused,
	});
	const space = useQuery({
		...deviceQueries.spaceLive(),
		enabled,
		...whileFocused,
	});
	const overview = useQuery({
		...deviceQueries.overview(),
		enabled,
		...whileFocused,
	});
	return useMemo(
		() =>
			flows.data && (space.data || overview.data)
				? needsOf(flows.data, knownComputers(overview.data, space.data))
				: undefined,
		[flows.data, space.data, overview.data],
	);
}

function needsOf(
	flows: readonly Pick<FlowListItem, "name" | "devices">[],
	known: readonly KnownComputer[],
): OfflineNeeds {
	const needs = new Map<string, readonly string[]>();
	for (const flow of flows) {
		const offline = offlineNeeds(flow.devices, known);
		if (offline.length > 0) needs.set(flow.name, offline);
	}
	return needs;
}
