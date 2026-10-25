import type { Flow } from "@nightshift/flows";
import {
	type UseQueryResult,
	useQueries,
	useQuery,
} from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { flowQueries } from "./queries";

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
		...flowQueries.list(projectId),
		staleTime: STALE_MS,
	});
	const names = useMemo(
		() =>
			(list.data ?? [])
				.map((item) => item.name)
				.filter((name) => name !== except),
		[list.data, except],
	);

	// The combined record keeps its identity while its content stays the same,
	// so a validation memo on it does not rerun each render.
	const combine = useCallback(
		(results: UseQueryResult<{ flow: Flow | null }>[]) => {
			if (!results.every((result) => result.isSuccess || result.isError)) {
				return undefined;
			}
			const flows: Record<string, Flow | null> = {};
			names.forEach((name, index) => {
				flows[name] = results[index]?.data?.flow ?? null;
			});
			return flows;
		},
		[names],
	);
	const flows = useQueries({
		queries: names.map((name) => ({
			...flowQueries.get(projectId, name),
			staleTime: STALE_MS,
			refetchOnWindowFocus: false,
			meta: { quietErrors: true },
		})),
		combine,
	});
	const settled = list.data !== undefined && flows !== undefined;
	return { flows: settled ? flows : undefined, isLoading: !settled };
}
