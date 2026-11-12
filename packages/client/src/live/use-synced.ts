import { type HostApi, useLiveCache } from "./use-live-cache";

/**
 * What a screen calls after a save that writes a synced document: a flow,
 * its history, the knowledge, a Space, or this computer. The live cache
 * reads that document again, in one burst with the stream's
 * `document-changed`. Call it in a mutation's `onSuccess` instead of
 * reading those queries again yourself. The function stays the same
 * between renders.
 */
export function useSynced(
	host: Pick<HostApi, "orpc">,
): (
	kind:
		| "flows"
		| "flows-history"
		| "knowledge"
		| "space"
		| "device"
		| "device-copy",
) => void {
	return useLiveCache(host.orpc).synced;
}
