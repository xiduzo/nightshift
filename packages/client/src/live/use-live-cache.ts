import { type QueryClient, useQueryClient } from "@tanstack/react-query";

import type { ApiQueryUtils } from "../api";
import { createLiveCache, type LiveCache } from "./cache";

/** One live cache per query client and Host, so every screen shares what it knows. */
const caches = new WeakMap<QueryClient, WeakMap<ApiQueryUtils, LiveCache>>();

/** The live cache of this query client on `orpc`: the Host the app talks to. */
export function useLiveCache(orpc: ApiQueryUtils): LiveCache {
	const queryClient = useQueryClient();
	let byHost = caches.get(queryClient);
	if (!byHost) {
		byHost = new WeakMap();
		caches.set(queryClient, byHost);
	}
	let cache = byHost.get(orpc);
	if (!cache) {
		cache = createLiveCache({ queryClient, orpc });
		byHost.set(orpc, cache);
	}
	return cache;
}
