import { randomUUID } from "node:crypto";
import type { Database } from "@nightshift/db";
import { invitation, member, organization, user } from "@nightshift/db/schema";
import { and, eq, gt, inArray, sql } from "drizzle-orm";

import type { Role } from "./roles";

/**
 * Members of a Space and how people join a Host.
 *
 * A Host is invitation-only. The first Person on it is the Host admin
 * (the admin plugin's `admin` role); after that, an email and password
 * account is made only with a pending invitation of that email, and the
 * sign-up names the invitation (`invitationId`). So an invitation is also
 * the account. Accepting it makes the Person a Member of its Space.
 *
 * There is no email server: the Members page shows the invitation link to
 * copy. A sender can hook into the organization plugin's
 * `sendInvitationEmail` later.
 */

/** The admin plugin's role of the Host admin. */
export const HOST_ADMIN = "admin";

/** A change of a Space's Members, with the Person who made it. */
export type MemberChange =
	| {
			kind: "joined";
			spaceId: string;
			personId: string;
			role: string;
			/** Who added them: themselves for an accepted invitation or a new Space. Null: unknown. */
			by: string | null;
			/** The Person who sent the invitation they accepted. */
			invitedBy?: string;
	  }
	| { kind: "removed"; spaceId: string; personId: string; by: string | null }
	| {
			kind: "role";
			spaceId: string;
			personId: string;
			role: string;
			previousRole: string;
			by: string | null;
	  };

/** Whether the Host has a Host admin yet. */
export async function hasHostAdmin(db: Database): Promise<boolean> {
	const [row] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.role, HOST_ADMIN))
		.limit(1);
	return row !== undefined;
}

/** Whether the Person is the Host admin. */
export async function isHostAdmin(
	db: Database,
	personId: string,
): Promise<boolean> {
	const [row] = await db
		.select({ role: user.role })
		.from(user)
		.where(eq(user.id, personId))
		.limit(1);
	return row?.role === HOST_ADMIN;
}

/**
 * Why an email and password sign-up is refused, or null when it may go
 * ahead: the Host's first Person always may; anyone else needs a pending,
 * unexpired invitation of that email, named by `invitationId`.
 */
export async function signUpRefusal(
	db: Database,
	body: { email?: unknown; invitationId?: unknown },
	now = Date.now(),
): Promise<string | null> {
	const [anyone] = await db.select({ id: user.id }).from(user).limit(1);
	if (!anyone) return null;
	const email = typeof body.email === "string" ? body.email.toLowerCase() : "";
	const id = typeof body.invitationId === "string" ? body.invitationId : "";
	if (!id) {
		return "New people join by invitation only. Open the invitation link you got.";
	}
	const [found] = await db
		.select({ id: invitation.id })
		.from(invitation)
		.where(
			and(
				eq(invitation.id, id),
				eq(invitation.status, "pending"),
				gt(invitation.expiresAt, new Date(now)),
				eq(sql`lower(${invitation.email})`, email),
			),
		)
		.limit(1);
	return found
		? null
		: "This invitation is not valid for this email. Ask for a new invitation.";
}

/** An invitation as the page that accepts it shows it, before anyone signs in. */
export type InvitationView = {
	id: string;
	spaceName: string;
	email: string;
	role: Role;
	inviterName: string;
	/** `expired`: pending, but past its time. */
	status: "pending" | "accepted" | "canceled" | "rejected" | "expired";
	/** Whether a Person with this email exists on this Host: sign in, not sign up. */
	hasAccount: boolean;
};

/** The invitation of that id, or null. The id is the secret of the link. */
export async function invitationView(
	db: Database,
	id: string,
	now = Date.now(),
): Promise<InvitationView | null> {
	const [row] = await db
		.select({
			id: invitation.id,
			email: invitation.email,
			role: invitation.role,
			status: invitation.status,
			expiresAt: invitation.expiresAt,
			spaceName: organization.name,
			inviterName: user.name,
		})
		.from(invitation)
		.innerJoin(organization, eq(organization.id, invitation.organizationId))
		.innerJoin(user, eq(user.id, invitation.inviterId))
		.where(eq(invitation.id, id))
		.limit(1);
	if (!row) return null;
	const [account] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(sql`lower(${user.email})`, row.email.toLowerCase()))
		.limit(1);
	const status =
		row.status === "pending" && row.expiresAt.getTime() <= now
			? "expired"
			: (row.status as InvitationView["status"]);
	return {
		id: row.id,
		spaceName: row.spaceName,
		email: row.email,
		role: (row.role ?? "member") as Role,
		inviterName: row.inviterName,
		status,
		hasAccount: account !== undefined,
	};
}

/** A Member of a Space, as the Members page lists them. */
export type SpaceMember = {
	/** The membership. */
	id: string;
	personId: string;
	name: string;
	email: string;
	role: Role;
	joinedAt: number;
};

/** A pending invitation of a Space. */
export type PendingInvitation = {
	id: string;
	email: string;
	role: Role;
	inviterName: string;
	expiresAt: number;
};

/** The Space's Members, oldest first, and its pending invitations that have not expired. */
export async function membersOf(
	db: Database,
	spaceId: string,
	now = Date.now(),
): Promise<{ members: SpaceMember[]; invitations: PendingInvitation[] }> {
	const members = await db
		.select({
			id: member.id,
			personId: member.userId,
			name: user.name,
			email: user.email,
			role: member.role,
			joinedAt: member.createdAt,
		})
		.from(member)
		.innerJoin(user, eq(user.id, member.userId))
		.where(eq(member.organizationId, spaceId))
		.orderBy(member.createdAt);
	const invitations = await db
		.select({
			id: invitation.id,
			email: invitation.email,
			role: invitation.role,
			inviterName: user.name,
			expiresAt: invitation.expiresAt,
		})
		.from(invitation)
		.innerJoin(user, eq(user.id, invitation.inviterId))
		.where(
			and(
				eq(invitation.organizationId, spaceId),
				eq(invitation.status, "pending"),
				gt(invitation.expiresAt, new Date(now)),
			),
		)
		.orderBy(invitation.createdAt);
	return {
		members: members.map((m) => ({
			...m,
			role: m.role as Role,
			joinedAt: m.joinedAt.getTime(),
		})),
		invitations: invitations.map((i) => ({
			...i,
			role: (i.role ?? "member") as Role,
			expiresAt: i.expiresAt.getTime(),
		})),
	};
}

/** Makes the Person the Host admin when the Host has none: the first Person. */
export async function claimHostAdmin(
	db: Database,
	personId: string,
): Promise<void> {
	if (await hasHostAdmin(db)) return;
	await db.update(user).set({ role: HOST_ADMIN }).where(eq(user.id, personId));
}

/** The Members of a Space by Person: their name and role, in no set order. */
export async function spaceRoster(
	db: Database,
	spaceId: string,
): Promise<{ id: string; name: string; role: string }[]> {
	return db
		.select({ id: user.id, name: user.name, role: member.role })
		.from(member)
		.innerJoin(user, eq(user.id, member.userId))
		.where(eq(member.organizationId, spaceId));
}

/** The Person's membership of the Space (its id and role), or null. */
export async function membershipOf(
	db: Database,
	spaceId: string,
	personId: string,
): Promise<{ id: string; role: string } | null> {
	const [row] = await db
		.select({ id: member.id, role: member.role })
		.from(member)
		.where(
			and(eq(member.organizationId, spaceId), eq(member.userId, personId)),
		);
	return row ?? null;
}

/** Makes the Person a Member of the Space in that role. */
export async function addMembership(
	db: Database,
	input: { spaceId: string; personId: string; role: string },
): Promise<void> {
	await db.insert(member).values({
		id: randomUUID(),
		organizationId: input.spaceId,
		userId: input.personId,
		role: input.role,
		createdAt: new Date(),
	});
}

/** Gives a membership another role. */
export async function setMembershipRole(
	db: Database,
	membershipId: string,
	role: string,
): Promise<void> {
	await db.update(member).set({ role }).where(eq(member.id, membershipId));
}

/** Ends the Person's memberships of these Spaces. */
export async function removeMemberships(
	db: Database,
	spaceIds: readonly string[],
	personId: string,
): Promise<void> {
	await db
		.delete(member)
		.where(
			and(
				inArray(member.organizationId, [...spaceIds]),
				eq(member.userId, personId),
			),
		);
}
