import type { PushTarget } from "../domain/push-targets";
import type { TargetStore } from "./ports";

export type FindTargetsPorts = { targetStore: Pick<TargetStore, "byIds"> };

/** Which targets. */
export type FindTargets = { ids: readonly string[] };

/**
 * These push targets, by id: the screens a held push waits for. An id
 * without a target is left out. Night Shift asks.
 */
export const findTargets =
	(ports: FindTargetsPorts) =>
	(request: FindTargets): Promise<PushTarget[]> =>
		ports.targetStore.byIds(request.ids);
