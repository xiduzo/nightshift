import { createSpaceQueries } from "@nightshift/client";
import { useQuery } from "@tanstack/react-query";

import { useHostQueries } from "@/features/host";
import type { HeaderItem } from "@/shared/header";
import { spaceMenu } from "./space-menu";
import { useSwitchSpace } from "./use-switch-space";

/**
 * The Space this phone works in, as a menu in a screen's header. Runs,
 * projects and starting a flow are per Space. Needs you shows every
 * Space and does not need it. Null until the Spaces load.
 */
export function useSpaceMenu(): HeaderItem | null {
	const spaceQueries = useHostQueries(createSpaceQueries);
	const spaces = useQuery(spaceQueries.list());
	const switchSpace = useSwitchSpace();
	if (!spaces.data) return null;
	return spaceMenu(
		spaces.data,
		switchSpace.isPending ? switchSpace.variables.spaceId : null,
		(spaceId) => switchSpace.mutate({ spaceId }),
	);
}
