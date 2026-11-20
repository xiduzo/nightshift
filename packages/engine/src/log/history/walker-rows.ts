import type { Database } from "@nightshift/db";
import { event, run, step } from "@nightshift/db/schema";
import { eq, sql } from "drizzle-orm";
import type { EnginePayloads } from "../events";

/** A fact of no run that an adoption logs at the count it takes over. */
export type AdoptedFact = {
	type: "DeviceJoined";
	spaceId: string;
	payload: EnginePayloads["DeviceJoined"];
};

/**
 * The statements that make `to` the Walker of every run, step and event
 * of `from` (ADR 20), for the batch of a Device's adoption. The events
 * count on from `lastSeq`, the last the Host has of `to`. `joined` holds
 * the place at that count. They read nothing.
 */
export function adoptWalkerRows(
	db: Database,
	move: {
		from: string;
		to: string;
		lastSeq: number;
		joined: AdoptedFact | null;
	},
) {
	const { from, to, lastSeq, joined } = move;
	return [
		db.update(run).set({ walkerId: to }).where(eq(run.walkerId, from)),
		db.update(run).set({ deviceId: to }).where(eq(run.deviceId, from)),
		db.update(step).set({ deviceId: to }).where(eq(step.deviceId, from)),
		db
			.update(event)
			.set({
				walkerId: to,
				walkerSeq: sql`${event.walkerSeq} + ${lastSeq}`,
			})
			.where(eq(event.walkerId, from)),
		...(joined
			? [
					db.insert(event).values({
						spaceId: joined.spaceId,
						type: joined.type,
						payload: JSON.stringify(joined.payload),
						walkerId: to,
						walkerSeq: lastSeq,
					}),
				]
			: []),
	];
}
