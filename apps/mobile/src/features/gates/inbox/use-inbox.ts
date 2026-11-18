import { createGateQueries } from "@nightshift/client";
import { useQuery } from "@tanstack/react-query";

import { useHostQueries } from "@/features/host";

/**
 * The open Gates of every Space you are in, oldest first. The live cache
 * keeps them live while the app is in front (`useFollowHost` in the shell).
 * A screen passes `useWhileFocused().subscribed`: hidden, it does not
 * render on a change. The tab bar is no screen: it stays subscribed.
 */
export function useInbox(subscribed: boolean) {
	const queries = useHostQueries(createGateQueries);
	return useQuery({ ...queries.open(), subscribed });
}
