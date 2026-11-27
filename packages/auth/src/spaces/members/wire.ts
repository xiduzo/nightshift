import { randomUUID } from "node:crypto";
import type { Database } from "@nightshift/db";
import { drizzleInvitationStore } from "./adapters/out/drizzle-invitation-store";
import { drizzleMemberStore } from "./adapters/out/drizzle-member-store";
import { drizzlePersonStore } from "./adapters/out/drizzle-person-store";
import { addMembership } from "./application/add-membership";
import { checkSignUp } from "./application/check-sign-up";
import { claimHostAdmin } from "./application/claim-host-admin";
import { hasHostAdmin } from "./application/has-host-admin";
import { isHostAdmin } from "./application/is-host-admin";
import { listMembers } from "./application/list-members";
import { listPersonNames } from "./application/list-person-names";
import type { MemberStore, PersonStore } from "./application/ports";
import { viewInvitation } from "./application/view-invitation";

/**
 * The wiring of members: the one place that builds its real adapters
 * and binds each use case to its ports.
 */

/** What the package gives members: what the real adapters stand on. */
export type MembersDeps = {
	db: Database;
};

/** The use cases of members, bound to their ports, and the calls of a port that other slices make. */
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
	listRoster: (request: {
		spaceId: string;
	}) => ReturnType<MemberStore["roster"]>;
	/** The Person's membership of the Space (its id and role), or null. */
	findMembership: (request: {
		spaceId: string;
		personId: string;
	}) => ReturnType<MemberStore["membershipOf"]>;
	/** Makes the Person a Member of the Space in that role. */
	addMembership: ReturnType<typeof addMembership>;
	/** Gives a membership another role. */
	setMembershipRole: (request: {
		membershipId: string;
		role: string;
	}) => ReturnType<MemberStore["setRole"]>;
	/** Ends the Person's memberships of these Spaces. */
	removeMemberships: (request: {
		spaceIds: readonly string[];
		personId: string;
	}) => ReturnType<MemberStore["remove"]>;
	/** The names of these Persons, by id. A Person this Replica does not know is missing. */
	listPersonNames: ReturnType<typeof listPersonNames>;
	/** The name and email of a Person, or null for one this Replica does not know. */
	findPersonContact: (request: {
		personId: string;
	}) => ReturnType<PersonStore["contact"]>;
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
		listRoster: ({ spaceId }) => ports.memberStore.roster(spaceId),
		findMembership: ({ spaceId, personId }) =>
			ports.memberStore.membershipOf(spaceId, personId),
		addMembership: addMembership(ports),
		setMembershipRole: ({ membershipId, role }) =>
			ports.memberStore.setRole(membershipId, role),
		removeMemberships: ({ spaceIds, personId }) =>
			ports.memberStore.remove(spaceIds, personId),
		listPersonNames: listPersonNames(ports),
		findPersonContact: ({ personId }) => ports.personStore.contact(personId),
	};
}
