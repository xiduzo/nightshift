import type { Database } from "@nightshift/db";
import { notificationDelivery } from "@nightshift/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { DeliveryStatus } from "./deliveries";

/** The statuses of an entry that has not reached a screen yet, and still may. */
const PENDING: DeliveryStatus[] = ["sending", "held", "quiet"];

/**
 * The statements that move the delivery log of runs to another Space, for
 * the `db.batch` that moves the runs (`spaceMoveBatch` of the engine).
 * The entries of `from` take the Space `to`: only those of `runIds`, when
 * given. When this daemon does not send the pushes of `to`
 * (`oneSenderPerSpace`: its Host does), what it still holds or was about
 * to send is dropped: the sender of `to` notifies for those runs now.
 * What went out stays, so its withdraw still reaches each screen.
 */
export function moveDeliveriesBatch(
	db: Database,
	input: {
		from: string;
		to: string;
		runIds?: readonly string[];
		/** Whether this daemon sends the pushes of `to`. */
		sends: boolean;
	},
): [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] {
	const ofMoved = and(
		eq(notificationDelivery.spaceId, input.from),
		input.runIds === undefined
			? undefined
			: inArray(notificationDelivery.runId, [...input.runIds]),
	);
	const move = db
		.update(notificationDelivery)
		.set({ spaceId: input.to })
		.where(ofMoved);
	if (input.sends) return [move];
	return [
		db
			.update(notificationDelivery)
			.set({ status: "dropped", heldFor: "[]", dueAt: null })
			.where(and(ofMoved, inArray(notificationDelivery.status, PENDING))),
		move,
	];
}
