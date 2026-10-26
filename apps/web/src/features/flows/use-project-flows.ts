import type { Flow } from "@nightshift/flows";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { flowQueries } from "./queries";

/** Other flow files change rarely while one is open in the editor. */
const STALE_MS = 30_000;

export type ProjectFlows = {
	/** The flow files of the project, by name. Null when a file does not parse. */
	flows: Readonly<Record<string, Flow | null>> | undefined;
	isLoading: boolean;
};

/**
 * Every flow file of a project, in one read (`flows.map`), for checking
 * the flows Subflow nodes name and for the called flow picker. `except`
 * skips one name, usually the flow open in the editor: its draft is newer
 * than the file. `flows` stays undefined until the read is done.
 */
export function useProjectFlows(
	projectId: string,
	except?: string,
): ProjectFlows {
	const map = useQuery({
		...flowQueries.map(projectId),
		staleTime: STALE_MS,
		refetchOnWindowFocus: false,
		meta: { quietErrors: true },
	});
	// Keeps its identity while the read does, so a validation memo on it does not rerun.
	const flows = useMemo(() => {
		if (!map.data) return undefined;
		if (except === undefined || !Object.hasOwn(map.data, except)) {
			return map.data;
		}
		const { [except]: _open, ...others } = map.data;
		return others;
	}, [map.data, except]);
	return { flows, isLoading: map.isPending };
}
