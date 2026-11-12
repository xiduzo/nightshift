import {
	type NodeSample,
	nodeSamples,
	type RunDetail,
} from "@nightshift/client";
import type { Flow } from "@nightshift/flows";
import {
	type UseQueryResult,
	useQueries,
	useQuery,
} from "@tanstack/react-query";
import { useMemo } from "react";
import { runQueries } from "@/features/runs/flows-port";

/** How many of the project's newest runs are searched for runs of the flow. */
const PROJECT_RUNS = 50;
/** How many runs of the flow give samples: a node the newest did not reach takes an older one's. */
const SAMPLE_RUNS = 3;

/** Each run's detail, or undefined while it loads. One array while none changes. */
function details(
	results: UseQueryResult<RunDetail>[],
): (RunDetail | undefined)[] {
	return results.map((result) => result.data);
}

/**
 * What each node of `flow` gave in the newest runs of the flow `flowName`,
 * by node id (`nodeSamples`). Null while the flow has no run, and until
 * one of its runs loads: the canvas then shows no viewers. A new run that
 * still loads leaves the older ones on view. The live cache reads a run
 * again when a step ends, so a running run fills them as it goes. With
 * `runId`, the samples come from that run only (a test run).
 */
export function useNodeSamples({
	projectId,
	flowName,
	flow,
	runId,
}: {
	projectId: string;
	flowName: string;
	flow: Flow;
	runId?: string;
}): ReadonlyMap<string, NodeSample> | null {
	const runs = useQuery({
		...runQueries.ofProject(projectId, PROJECT_RUNS),
		enabled: runId === undefined,
		meta: { quietErrors: true },
	});
	const ids = useMemo(
		() =>
			runId !== undefined
				? [runId]
				: (runs.data ?? [])
						.filter((run) => run.flowName === flowName)
						.sort((a, b) => b.createdAt - a.createdAt)
						.slice(0, SAMPLE_RUNS)
						.map((run) => run.id),
		[runs.data, flowName, runId],
	);
	const loaded = useQueries({
		queries: ids.map((id) => ({
			...runQueries.get(id),
			meta: { quietErrors: true },
		})),
		combine: details,
	});
	return useMemo(() => {
		const runsOfFlow = loaded.filter((run) => run !== undefined);
		return runsOfFlow.length === 0 ? null : nodeSamples(runsOfFlow, flow);
	}, [loaded, flow]);
}
