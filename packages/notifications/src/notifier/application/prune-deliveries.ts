import type { PruneClock } from "../domain/notifier-state";
import type { DeliveryLog } from "./ports";

export type PruneDeliveriesPorts = {
	pruning: PruneClock;
	deliveries: Pick<DeliveryLog, "prune">;
	/** How long the inbox keeps an entry, in ms: the engine's `INBOX_KEEP_MS` (90 days). */
	inboxKeepMs: number;
};

/** The instant of the check. */
export type PruneDeliveries = { at: number };

/** Removes the entries older than the inbox keeps, once an hour. */
export const pruneDeliveries =
	(ports: PruneDeliveriesPorts) =>
	async ({ at }: PruneDeliveries): Promise<void> => {
		if (!ports.pruning.due(at)) return;
		await ports.deliveries.prune(at - ports.inboxKeepMs);
	};
