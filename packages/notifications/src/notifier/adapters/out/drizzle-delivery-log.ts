import type { Database } from "@nightshift/db";
import { createDeliveryLog } from "../../../deliveries";
import type { DeliveryLog } from "../../application/ports";

/**
 * The delivery log on the database: the statements of `deliveries/`, one
 * row per (Person, event key) in `notification_delivery`.
 */
export function drizzleDeliveryLog(db: Database): DeliveryLog {
	const log = createDeliveryLog(db);
	return {
		claim: (claim, change, now) => log.claim(claim, change, now),
		update: (personId, key, change) => log.update(personId, key, change),
		live: (key) => log.live(key),
		liveOfKind: (kind) => log.liveOfKind(kind),
		held: () => log.held(),
		sending: () => log.sending(),
		quiet: () => log.quiet(),
		prune: (before) => log.prune(before),
	};
}
