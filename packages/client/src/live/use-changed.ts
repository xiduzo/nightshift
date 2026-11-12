import type { Change } from "../changes";
import { type HostApi, useLiveCache } from "./use-live-cache";

/**
 * What a screen calls when something changed that is not a save route the
 * live cache sees: a job that ended (an agent's setup, a project's copy),
 * or a save through the client itself. A save of an oRPC mutation needs
 * no call: the live cache reads what its route wrote. The function stays
 * the same between renders.
 */
export function useChanged(
	host: Pick<HostApi, "orpc">,
): (...changes: Change[]) => void {
	return useLiveCache(host.orpc).changed;
}
