import { Refusal, type RefusalKind } from "@nightshift/refusal";
import { type Permissions, type Role, roleAllows } from "../../../spaces";
import type { Organizations } from "../../application/ports";
import { ROLE_REFUSAL } from "../../domain/space-access";

/** A Member as the in-memory `Organizations` keeps them. */
export type MemberRecord = {
	id: string;
	spaceId: string;
	personId: string;
	role: Role;
};

/** An invitation as the in-memory `Organizations` keeps it. */
export type InvitationRecord = {
	id: string;
	spaceId: string;
	email: string;
	role: Role;
	status: "pending" | "accepted" | "canceled";
};

const refusal = (kind: RefusalKind, message: string) =>
	new Refusal(kind, message);

/** The refusals of the organization plugin, in the words `refuse` gives them. */
const REFUSED = {
	notMember: () => refusal("forbidden", "You are not a member of that Space."),
	role: () => refusal("forbidden", ROLE_REFUSAL.message),
	memberAlready: () =>
		refusal("conflict", "This person is a member of this Space already."),
	invitedAlready: () =>
		refusal("conflict", "This person has an invitation to this Space already."),
	noInvitation: () =>
		refusal(
			"not-found",
			"This invitation does not exist anymore. Ask for a new one.",
		),
	otherEmail: () =>
		refusal(
			"forbidden",
			"This invitation is for another email. Sign in with the email that got it.",
		),
	noMember: () =>
		refusal("not-found", "This person is not a member of this Space anymore."),
};

/**
 * `Organizations` in memory. `personOf` tells who the headers carry (the
 * session twin knows), and `emailOf` the email of a Person. The Spaces,
 * Members and invitations are in `spaces`, `members` and `invitations`,
 * and the active Space of each Person is in `active`.
 */
export function inMemoryOrganizations(who: {
	personOf(headers: Headers): string | null;
	emailOf(personId: string): string;
}) {
	let next = 0;
	const id = (kind: string) => `${kind}-${++next}`;
	const spaces = new Map<string, { name: string; slug: string }>();
	const members: MemberRecord[] = [];
	const invitations: InvitationRecord[] = [];
	const active = new Map<string, string>();

	const actor = (headers: Headers) => {
		const personId = who.personOf(headers);
		if (!personId) throw refusal("signed-out", "Sign in to use Night Shift.");
		return personId;
	};
	const memberIn = (spaceId: string, personId: string) =>
		members.find((m) => m.spaceId === spaceId && m.personId === personId);
	/** The actor's membership of the Space, when their role allows `permissions`. */
	const allowed = (
		headers: Headers,
		spaceId: string,
		permissions: Permissions,
	) => {
		const membership = memberIn(spaceId, actor(headers));
		if (!membership) throw REFUSED.notMember();
		if (!roleAllows(membership.role, permissions)) throw REFUSED.role();
		return membership;
	};
	const memberOf = (spaceId: string, memberId: string) => {
		const found = members.find(
			(m) => m.id === memberId && m.spaceId === spaceId,
		);
		if (!found) throw REFUSED.noMember();
		return found;
	};

	const twin = {
		spaces,
		members,
		invitations,
		active,
		async setActive(headers: Headers, spaceId: string) {
			const personId = actor(headers);
			if (!memberIn(spaceId, personId)) throw REFUSED.notMember();
			active.set(personId, spaceId);
		},
		async create(headers: Headers, space: { name: string; slug: string }) {
			const personId = actor(headers);
			const spaceId = id("space");
			spaces.set(spaceId, space);
			members.push({ id: id("member"), spaceId, personId, role: "owner" });
			active.set(personId, spaceId);
			return { id: spaceId };
		},
		async invite(
			headers: Headers,
			invitation: { email: string; role: Role; spaceId: string },
		) {
			allowed(headers, invitation.spaceId, { invitation: ["create"] });
			const { email, spaceId } = invitation;
			const joined = members.some(
				(m) => m.spaceId === spaceId && who.emailOf(m.personId) === email,
			);
			if (joined) throw REFUSED.memberAlready();
			const pending = invitations.some(
				(i) =>
					i.spaceId === spaceId && i.email === email && i.status === "pending",
			);
			if (pending) throw REFUSED.invitedAlready();
			const made = { id: id("invitation"), ...invitation };
			invitations.push({ ...made, status: "pending" });
			return { id: made.id };
		},
		async cancelInvitation(headers: Headers, invitationId: string) {
			const found = invitations.find((i) => i.id === invitationId);
			if (!found) throw REFUSED.noInvitation();
			allowed(headers, found.spaceId, { invitation: ["cancel"] });
			found.status = "canceled";
		},
		async setRole(
			headers: Headers,
			change: { memberId: string; role: Role; spaceId: string },
		) {
			allowed(headers, change.spaceId, { member: ["update"] });
			memberOf(change.spaceId, change.memberId).role = change.role;
		},
		async remove(
			headers: Headers,
			member: { memberId: string; spaceId: string },
		) {
			allowed(headers, member.spaceId, { member: ["delete"] });
			const found = memberOf(member.spaceId, member.memberId);
			members.splice(members.indexOf(found), 1);
		},
		async accept(headers: Headers, invitationId: string) {
			const personId = actor(headers);
			const found = invitations.find(
				(i) => i.id === invitationId && i.status === "pending",
			);
			if (!found) throw REFUSED.noInvitation();
			if (found.email !== who.emailOf(personId)) throw REFUSED.otherEmail();
			found.status = "accepted";
			members.push({
				id: id("member"),
				spaceId: found.spaceId,
				personId,
				role: found.role,
			});
			active.set(personId, found.spaceId);
			return { spaceId: found.spaceId };
		},
	};
	return twin satisfies Organizations;
}

export type InMemoryOrganizations = ReturnType<typeof inMemoryOrganizations>;
