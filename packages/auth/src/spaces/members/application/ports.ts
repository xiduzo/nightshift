import type { PendingInvitation, SpaceMember } from "./list-members";
import type { StoredInvitation } from "./view-invitation";

/**
 * The driven ports of members. A port of its own has a real adapter, an
 * in-memory adapter and a contract suite in `adapters/out/`.
 */

/** The accounts of the Persons of this Replica. */
export type PersonStore = {
	/** Whether this Replica has a Person at all. */
	hasAnyone(): Promise<boolean>;
	/** Whether a Person has the admin plugin's role `role`. */
	hasRole(role: string): Promise<boolean>;
	/** The admin plugin's role of the Person, or null for one this Replica does not know. */
	roleOf(personId: string): Promise<string | null>;
	/** Gives the Person the admin plugin's role `role`. */
	setRole(personId: string, role: string): Promise<void>;
	/** Whether a Person has this email, compared in lower case. `email` is in lower case. */
	hasAccount(email: string): Promise<boolean>;
	/** The names of the Persons of these ids that this Replica knows. `ids` is not empty. */
	names(ids: readonly string[]): Promise<Map<string, string>>;
	/** The name and email of a Person, or null. */
	contact(personId: string): Promise<{ name: string; email: string } | null>;
};

/** The invitations to the Spaces of this Replica. */
export type InvitationStore = {
	/**
	 * Whether the invitation of that id is pending for `email` (compared in
	 * lower case) and expires after `now`.
	 */
	isOpen(request: { id: string; email: string; now: number }): Promise<boolean>;
	/** The invitation of that id, or null. */
	find(id: string): Promise<StoredInvitation | null>;
	/** The pending invitations of a Space that expire after `now`, oldest first. */
	pendingOf(spaceId: string, now: number): Promise<PendingInvitation[]>;
};

/** The memberships of the Spaces of this Replica. */
export type MemberStore = {
	/** The Members of a Space with their names and emails, oldest first. */
	membersOf(spaceId: string): Promise<SpaceMember[]>;
	/** The Members of a Space by Person: their name and role, in no set order. */
	roster(
		spaceId: string,
	): Promise<{ id: string; name: string; role: string }[]>;
	/** The Person's membership of the Space, or null. */
	membershipOf(
		spaceId: string,
		personId: string,
	): Promise<{ id: string; role: string } | null>;
	/** Adds a membership of that id. */
	add(membership: {
		id: string;
		spaceId: string;
		personId: string;
		role: string;
	}): Promise<void>;
	/** Gives a membership another role. */
	setRole(membershipId: string, role: string): Promise<void>;
	/** Removes the Person's memberships of these Spaces. */
	remove(spaceIds: readonly string[], personId: string): Promise<void>;
};
