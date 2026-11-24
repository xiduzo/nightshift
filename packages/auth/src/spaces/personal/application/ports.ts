import type { RowBatch } from "../domain/personal-space";

/**
 * The driven ports of personal. A port of its own has a real adapter and
 * its test in `adapters/out/`.
 */

/** The personal Spaces of this Replica and the rows that make one. */
export type PersonalSpaceStore = {
	/** The id of the personal Space the Person is a member of, or null. */
	personalSpaceId(personId: string): Promise<string | null>;
	/** The id of the Space with that slug, or null. It needs no membership. */
	spaceIdBySlug(slug: string): Promise<string | null>;
	/** Whether a Space of that id exists. */
	exists(spaceId: string): Promise<boolean>;
	/** The id of the Person's membership of the Space, or null. */
	membershipId(spaceId: string, personId: string): Promise<string | null>;
	/**
	 * Makes a personal Space with the Person as its owner, both rows at once:
	 * when the membership fails, the Space is not made either.
	 */
	create(space: {
		id: string;
		name: string;
		slug: string;
		personId: string;
		membershipId: string;
	}): Promise<void>;
	/**
	 * The statements that make `to` the Person's personal Space in place of
	 * `from`: the Person owns `to` (their membership `membershipId`, else a
	 * new one of id `newMembershipId`), `to` is personal and has `name`,
	 * sessions in `from` work in `to`, and `from` goes with its members and
	 * invitations.
	 */
	adoptRows(change: {
		personId: string;
		from: string;
		to: string;
		name: string;
		membershipId: string | null;
		newMembershipId: string;
	}): RowBatch;
	/**
	 * The statements that give the Person the new personal Space `to` (with
	 * `name`, `slug` and their membership `membershipId`) in place of
	 * `from`: sessions in `from` work in `to`, and `from` stays, no longer
	 * personal, named `fromName`, without the Person.
	 */
	splitRows(change: {
		personId: string;
		from: string;
		to: string;
		name: string;
		slug: string;
		membershipId: string;
		fromName: string;
	}): RowBatch;
};

/** The account of the Person who owns this computer. */
export type LocalPersonStore = {
	/** The Person of that id, or null. */
	find(personId: string): Promise<{ id: string; name: string } | null>;
	/** The Person with that email, or null. */
	findByEmail(email: string): Promise<{ id: string; name: string } | null>;
	/** Adds a Person with the admin plugin's role `role`. */
	add(person: {
		id: string;
		name: string;
		email: string;
		role: string;
	}): Promise<void>;
	/** Gives the Person another name. */
	rename(personId: string, name: string): Promise<void>;
};
