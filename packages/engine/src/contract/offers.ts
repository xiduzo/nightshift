import type { Schedule } from "@nightshift/flows";
import type { Actor } from "./actor";

/** The Offer rule of a schedule on another Person's Device (`Peers.offers`). */
export type OffersPort = {
	/**
	 * The schedules of a project as a Person saves them: a schedule that
	 * fires on another Person's Device gets the saver as its `person`, and
	 * is refused unless that Device's Offers cover what its flow runs there.
	 */
	schedulesWithOffers(
		project: { id: string; repoPath: string },
		spaceId: string,
		actor: Actor | undefined,
		schedules: readonly Schedule[],
	): Promise<Schedule[]>;
};
