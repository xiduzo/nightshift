import { createGateQueries, waitingForYou } from "@nightshift/client";
import { useQuery } from "@tanstack/react-query";

import { useHostQueries } from "@/features/host";
import { useWhileFocused } from "@/shared/refresh";

/**
 * The open Gates of every Space you are in, oldest first. The live cache
 * keeps them live while the app is in front (`useFollowHost` in the shell).
 */
export function useInbox() {
	const queries = useHostQueries(createGateQueries);
	return useQuery({ ...queries.open(), ...useWhileFocused() });
}

/** How many Gates wait for you: the ones you may answer. For the tab badge. */
export function useWaitingCount(): number {
	const queries = useHostQueries(createGateQueries);
	const inbox = useQuery({
		...queries.open(),
		select: waitingForYou,
	});
	return inbox.data ?? 0;
}
