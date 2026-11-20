import type { Database } from "@nightshift/db";
import { clone } from "@nightshift/db/schema";
import { eq } from "drizzle-orm";

/**
 * The statements of a Device's Clones, for the batch of a Device's own
 * rows (`PeerContext.deviceRows`). They read nothing: the caller runs them
 * in its batch, in the order it gives them.
 */
export function cloneRowsOfDevice(db: Database) {
	return {
		/** Forgets the Clones of a Device that is gone. */
		forget: (deviceId: string) =>
			db.delete(clone).where(eq(clone.deviceId, deviceId)),
		/** The Clones of `from` become those of `to` (ADR 20). */
		adopt: (from: string, to: string) =>
			db.update(clone).set({ deviceId: to }).where(eq(clone.deviceId, from)),
	};
}
