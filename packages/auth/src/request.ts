import { randomUUID } from "node:crypto";
import type { Database } from "@nightshift/db";

import type { Permissions, Role } from "./access";
import {
	type HostAccess,
	type HostPolicy,
	hostAccess,
	OPEN_HOST,
} from "./host-access";
import { type Auth, hasPermission, type Session } from "./index";
import type { LocalSession } from "./local-session";
import { activeSpaceId } from "./spaces";

/** Who a request is, in which Space, and what they may do there. */
export type RequestAccess = {
	session: Session | null;
	/** The session's active Space, else the Person's personal Space. Null without a session. */
	spaceId: string | null;
	/** The request's headers, with the local session when it got one: pass these to Better Auth. */
	headers: Headers;
	/**
	 * Whether the session may use the Host (`host-access.ts`). Refused: a
	 * session from another computer on a Host that requires two-factor,
	 * whose Person has not turned it on.
	 */
	hostAccess: HostAccess;
	/**
	 * The organization plugin's `hasPermission` for the session in
	 * `spaceId`, or in another Space of the Person's.
	 */
	can(permissions: Permissions, inSpace?: string): Promise<boolean>;
	/**
	 * Makes a Space the session's active one (the organization plugin's
	 * `setActiveOrganization`). Refused when the Person is not a member.
	 */
	setActiveSpace(spaceId: string): Promise<void>;
	/**
	 * Makes a new Space with the session's Person as its owner, and makes
	 * it the session's active one.
	 */
	createSpace(name: string): Promise<{ id: string }>;
	/**
	 * The Members of the session's Space, through the organization plugin
	 * (which checks the role again). The caller checks `member.*` first.
	 */
	members: {
		/** A pending invitation of that email, with a role. Its id is the link's secret. */
		invite(email: string, role: Role): Promise<{ id: string }>;
		cancelInvitation(invitationId: string): Promise<void>;
		setRole(memberId: string, role: Role): Promise<void>;
		remove(memberId: string): Promise<void>;
		/** The session's Person accepts an invitation of their email: they join its Space and work in it. */
		accept(invitationId: string): Promise<{ spaceId: string }>;
	};
};

/**
 * Resolves a request's session and Space. `local` gives a request from
 * this computer without a session of its own the local Person's session;
 * pass null for any other request. `policy` is the Host's rules for
 * sessions from other computers.
 */
export async function requestAccess(
	auth: Auth,
	db: Database,
	headers: Headers,
	local: LocalSession | null,
	policy: HostPolicy = OPEN_HOST,
): Promise<RequestAccess> {
	const resolved = local
		? await local.resolve(headers)
		: { session: await auth.api.getSession({ headers }), headers };
	const { session } = resolved;
	const spaceId = session ? await activeSpaceId(db, session.session) : null;
	const inSpace = () => {
		if (!spaceId) throw new Error("Sign in to use Night Shift.");
		return spaceId;
	};
	return {
		session,
		spaceId,
		headers: resolved.headers,
		hostAccess: hostAccess(policy, {
			session,
			fromThisComputer: local !== null,
		}),
		can: (permissions, inSpace) => {
			const space = inSpace ?? spaceId;
			return space && session
				? hasPermission(auth, resolved.headers, space, permissions)
				: Promise.resolve(false);
		},
		async setActiveSpace(id) {
			await auth.api.setActiveOrganization({
				headers: resolved.headers,
				body: { organizationId: id },
			});
		},
		members: {
			async invite(email, role) {
				const created = await auth.api.createInvitation({
					headers: resolved.headers,
					body: { email, role, organizationId: inSpace() },
				});
				return { id: created.id };
			},
			async cancelInvitation(invitationId) {
				await auth.api.cancelInvitation({
					headers: resolved.headers,
					body: { invitationId },
				});
			},
			async setRole(memberId, role) {
				await auth.api.updateMemberRole({
					headers: resolved.headers,
					body: { memberId, role, organizationId: inSpace() },
				});
			},
			async remove(memberId) {
				await auth.api.removeMember({
					headers: resolved.headers,
					body: { memberIdOrEmail: memberId, organizationId: inSpace() },
				});
			},
			async accept(invitationId) {
				const accepted = await auth.api.acceptInvitation({
					headers: resolved.headers,
					body: { invitationId },
				});
				if (!accepted) throw new Error("Could not accept the invitation.");
				return { spaceId: accepted.member.organizationId };
			},
		},
		async createSpace(name) {
			const created = await auth.api.createOrganization({
				headers: resolved.headers,
				body: { name, slug: `${slugOf(name)}-${randomUUID().slice(0, 8)}` },
			});
			if (!created) throw new Error("Could not create the Space.");
			return { id: created.id };
		},
	};
}

/** A slug from a Space's name: lower case letters, digits and dashes. */
function slugOf(name: string): string {
	return (
		name
			.normalize("NFKD")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 40) || "space"
	);
}
