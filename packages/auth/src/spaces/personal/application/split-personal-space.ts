import {
	hereAlready,
	notPersonal,
	personalSlug,
	personalSpaceName,
	type RowBatch,
} from "../domain/personal-space";
import type { PersonalSpaceStore } from "./ports";

export type SplitPersonalSpacePorts = {
	personalSpaceStore: Pick<
		PersonalSpaceStore,
		"personalSpaceId" | "exists" | "spaceIdBySlug" | "splitRows"
	>;
	/** A new id, for the membership of the new Space. */
	newId: () => string;
};

/** Whose personal Space `from` splits into the new Space `to`, and the name of the Host. */
export type SplitPersonalSpace = {
	personId: string;
	from: string;
	to: string;
	hostName: string;
};

/**
 * The statements that give the Person a new personal Space `to` of this
 * Replica's own in place of `from`, the personal Space their Home Host
 * keeps, for the `db.batch` that moves the rows this Device takes along
 * (ADR 1: leaving keeps a copy). The reverse of `adoptPersonalSpace`.
 *
 * `to` is made, named "Personal", with the Person as its owner. A session
 * that worked in `from` works in `to`. `from` stays, with the rows that
 * do not come along, as the Host's Space: it is no longer personal here,
 * it takes the name "Personal on <Host>" (`hostName`), and the Person is
 * no longer a Member of it here.
 * Throws when `from` is not the Person's personal Space, or `to` exists.
 */
export const splitPersonalSpace =
	(ports: SplitPersonalSpacePorts) =>
	async (request: SplitPersonalSpace): Promise<RowBatch> => {
		const { personId, from, to, hostName } = request;
		const store = ports.personalSpaceStore;
		if ((await store.personalSpaceId(personId)) !== from) {
			throw new Error(notPersonal(from, personId));
		}
		if (await store.exists(to)) throw new Error(hereAlready(to));
		// The slug of a personal Space, unless an older Space still has it.
		const slug = personalSlug(personId);
		const taken = (await store.spaceIdBySlug(slug)) !== null;
		return store.splitRows({
			personId,
			from,
			to,
			name: personalSpaceName(),
			slug: taken ? `${slug}-${to}` : slug,
			membershipId: ports.newId(),
			fromName: personalSpaceName(hostName),
		});
	};
