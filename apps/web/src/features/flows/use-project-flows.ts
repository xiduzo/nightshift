import type { Flow } from "@nightshift/flows";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { orpc } from "@/shared/api";

/** Other flow files change rarely while one is open in the editor. */
const STALE_MS = 30_000;

export type ProjectFlows = {
	/** The flow files of the project, by name. Null when a file does not parse. */
	flows: Readonly<Record<string, Flow | null>> | undefined;
	isLoading: boolean;
};

/**
 * Every flow file of a project, loaded through `flows.get` and cached per
 * file, for checking the flows Call nodes name and for the called flow picker.
 * `except` skips one name, usually the flow open in the editor: its draft is
 * newer than the file. `flows` stays undefined until every file has loaded.
 */
export function useProjectFlows(
	projectId: string,
	except?: string,
): ProjectFlows {
	const list = useQuery({
		...orpc.flows.list.queryOptions({ input: { projectId } }),
		staleTime: STALE_MS,
	});
	const names = (list.data ?? [])
		.map((item) => item.name)
		.filter((name) => name !== except);

	const results = useQueries({
		queries: names.map((name) => ({
			...orpc.flows.get.queryOptions({ input: { projectId, name } }),
			staleTime: STALE_MS,
			refetchOnWindowFocus: false,
			meta: { quietErrors: true },
		})),
	});
	const settled =
		list.data !== undefined &&
		results.every((result) => result.isSuccess || result.isError);

	// One snapshot per content, so a validation memo on it does not rerun each render.
	let snapshot: string | null = null;
	if (settled) {
		const flows: Record<string, Flow | null> = {};
		names.forEach((name, index) => {
			flows[name] = results[index]?.data?.flow ?? null;
		});
		snapshot = JSON.stringify(flows);
	}
	const flows = useMemo(
		() =>
			snapshot === null
				? undefined
				: (JSON.parse(snapshot) as Record<string, Flow | null>),
		[snapshot],
	);
	return { flows, isLoading: !settled };
}
