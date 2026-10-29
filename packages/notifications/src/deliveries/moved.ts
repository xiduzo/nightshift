import type { Database } from "@nightshift/db";
import { notificationDelivery } from "@nightshift/db/schema";
import type { MoveRows } from "@nightshift/engine";
import { and, eq, inArray } from "drizzle-orm";
import type { DeliveryStatus } from "./deliveries";

/** The statuses of an entry that has not reached a screen yet, and still may. */
const PENDING: DeliveryStatus[] = ["sending", "held", "quiet"];

/**
 * The delivery log of the runs a Space move takes along (`MoveRows`, the
 * engine's port): their entries take the Space the runs go to. When this
 * daemon does not send the pushes of that Space (`sendsFor`, the rule
 * of `oneSenderPerSpace`: its Host does), what it still holds or was
 * about to send is dropped: the sender of that Space notifies for those
 * runs now. What went out stays, so its withdraw still reaches each
 * screen.
 */
export function deliveryMoves(
	db: Database,
	sendsFor: (spaceId: string) => Promise<boolean>,
): MoveRows {
	return async ({ from, to, runIds }) => {
		const ofMoved = and(
			eq(notificationDelivery.spaceId, from),
			inArray(notificationDelivery.runId, [...runIds]),
		);
		const move = db
			.update(notificationDelivery)
			.set({ spaceId: to })
			.where(ofMoved);
		if (await sendsFor(to)) return [move];
		return [
			db
				.update(notificationDelivery)
				.set({ status: "dropped", heldFor: "[]", dueAt: null })
				.where(and(ofMoved, inArray(notificationDelivery.status, PENDING))),
			move,
		];
	};
}
