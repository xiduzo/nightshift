import { type HostApi, useLiveCache } from "./use-live-cache";

/**
 * What a screen calls after the person acted on a run: started, stopped,
 * resumed or moved it, ran a step again, or sent it a signal. The live
 * cache reads that run again, in one burst with what the streams read.
 * Call it in a mutation's `onSuccess` instead of reading the runs again
 * yourself. The function stays the same between renders.
 */
export function useRunActed(
	host: Pick<HostApi, "orpc">,
): (runId: string) => void {
	return useLiveCache(host.orpc).runActed;
}
