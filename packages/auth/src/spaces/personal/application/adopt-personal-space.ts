import {
	notHere,
	notPersonal,
	OWN_PLACE,
	personalSpaceName,
	type RowBatch,
} from "../domain/personal-space";
import type { PersonalSpaceStore } from "./ports";

export type AdoptPersonalSpacePorts = {
	personalSpaceStore: Pick<
		PersonalSpaceStore,
		"personalSpaceId" | "exists" | "membershipId" | "adoptRows"
	>;
	/** A new id, for a membership the Person does not have yet. */
	newId: () => string;
};

/** Whose personal Space `from` takes the place of, and the Space `to` that takes it. */
export type AdoptPersonalSpace = { personId: string; from: string; to: string };

/**
 * The statements that make `to` the Person's personal Space in place of
 * `from`, for the `db.batch` that moves the rows of `from` into `to` (ADR
 * 1: one personal Space per Home Host). `to` is the Space this Replica
 * keeps a copy of, the one the Person's Home Host keeps as theirs.
 *
 * `to` becomes the Person's personal Space, named "Personal", with the
 * Person as its owner here. A session that worked in `from` works in
 * `to`. `from` goes, with its members and invitations: its rows are in
 * `to` now. Throws when `from` is not the Person's personal Space.
 */
export const adoptPersonalSpace =
	(ports: AdoptPersonalSpacePorts) =>
	async (request: AdoptPersonalSpace): Promise<RowBatch> => {
		const { personId, from, to } = request;
		const store = ports.personalSpaceStore;
		if ((await store.personalSpaceId(personId)) !== from) {
			throw new Error(notPersonal(from, personId));
		}
		if (from === to) throw new Error(OWN_PLACE);
		if (!(await store.exists(to))) throw new Error(notHere(to));
		const membershipId = await store.membershipId(to, personId);
		return store.adoptRows({
			personId,
			from,
			to,
			name: personalSpaceName(),
			membershipId,
			newMembershipId: ports.newId(),
		});
	};
