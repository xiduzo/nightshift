import { randomUUID } from "node:crypto";
import type { Database } from "@nightshift/db";
import { drizzleInvitationStore } from "./adapters/out/drizzle-invitation-store";
import { drizzleMemberStore } from "./adapters/out/drizzle-member-store";
import { drizzlePersonStore } from "./adapters/out/drizzle-person-store";
import { addMembership } from "./application/add-membership";
import { checkSignUp } from "./application/check-sign-up";
import { claimHostAdmin } from "./application/claim-host-admin";
import { findMembership } from "./application/find-membership";
import { findPersonContact } from "./application/find-person-contact";
import { hasHostAdmin } from "./application/has-host-admin";
import { isHostAdmin } from "./application/is-host-admin";
import { listMembers } from "./application/list-members";
import { listPersonNames } from "./application/list-person-names";
import { listRoster } from "./application/list-roster";
import { removeMemberships } from "./application/remove-memberships";
import { setMembershipRole } from "./application/set-membership-role";
import { viewInvitation } from "./application/view-invitation";

/**
 * The wiring of members: the one place that builds its real adapters
 * and binds each use case to its ports.
 */

/** What the package gives members: what the real adapters stand on. */
export type MembersDeps = {
	db: Database;
};

/** The use cases of members, bound to their ports. */
export type Members = {
	/** Whether the Host has a Host admin yet. */
	hasHostAdmin: ReturnType<typeof hasHostAdmin>;
	/** Whether the Person is the Host admin. */
	isHostAdmin: ReturnType<typeof isHostAdmin>;
	/** Makes the Person the Host admin when the Host has none: the first Person. */
	claimHostAdmin: ReturnType<typeof claimHostAdmin>;
	/** Why an email and password sign-up is refused, or null when it may go ahead. */
	checkSignUp: ReturnType<typeof checkSignUp>;
	/** The invitation of that id, as the page that accepts it shows it, or null. */
	viewInvitation: ReturnType<typeof viewInvitation>;
	/** The Members of a Space, oldest first, and its pending invitations that have not expired. */
	listMembers: ReturnType<typeof listMembers>;
	/** The Members of a Space by Person: their name and role, in no set order. */
	listRoster: ReturnType<typeof listRoster>;
	/** The Person's membership of the Space, or null. */
	findMembership: ReturnType<typeof findMembership>;
	/** Makes the Person a Member of the Space in that role. */
	addMembership: ReturnType<typeof addMembership>;
	/** Gives a membership another role. */
	setMembershipRole: ReturnType<typeof setMembershipRole>;
	/** Ends the Person's memberships of these Spaces. */
	removeMemberships: ReturnType<typeof removeMemberships>;
	/** The names of these Persons, by id. A Person this Replica does not know is missing. */
	listPersonNames: ReturnType<typeof listPersonNames>;
	/** The name and email of a Person, or null for one this Replica does not know. */
	findPersonContact: ReturnType<typeof findPersonContact>;
};

export function wireMembers(deps: MembersDeps): Members {
	const ports = {
		newId: () => randomUUID(),
		personStore: drizzlePersonStore(deps.db),
		invitationStore: drizzleInvitationStore(deps.db),
		memberStore: drizzleMemberStore(deps.db),
	};
	return {
		hasHostAdmin: hasHostAdmin(ports),
		isHostAdmin: isHostAdmin(ports),
		claimHostAdmin: claimHostAdmin(ports),
		checkSignUp: checkSignUp(ports),
		viewInvitation: viewInvitation(ports),
		listMembers: listMembers(ports),
		listRoster: listRoster(ports),
		findMembership: findMembership(ports),
		addMembership: addMembership(ports),
		setMembershipRole: setMembershipRole(ports),
		removeMemberships: removeMemberships(ports),
		listPersonNames: listPersonNames(ports),
		findPersonContact: findPersonContact(ports),
	};
}
