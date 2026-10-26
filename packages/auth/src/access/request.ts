import { randomUUID } from "node:crypto";
import type { Database } from "@nightshift/db";
import { Refusal } from "@nightshift/refusal";

import type { Auth, Session } from "../auth";
import {
	type HostAccess,
	type HostPolicy,
	hostAccess,
	OPEN_HOST,
} from "../host-access";
import type { LocalSession } from "../local-session";
import {
	ensurePersonalSpace,
	type Permissions,
	type Role,
	roleAllows,
	type Space,
	spacesOf,
} from "../spaces";
import { refuse } from "./auth-refusals";

/**
 * Who a request is, in which Space, and what they may do there. It reads
 * the session and the Person's memberships once, when the request starts,
 * and answers `can` from the role it has, in memory.
 */
export type RequestAccess = {
	session: Session | null;
	/** The session's active Space, else the Person's personal Space. Null without a session. */
	spaceId: string | null;
	/** The request's headers, with the local session when it got one: pass these to Better Auth. */
	headers: Headers;
	/**
	 * Whether the session may use the Host (`host-access/`). Refused: a
	 * session from another computer on a Host that requires two-factor,
	 * whose Person has not turned it on.
	 */
	hostAccess: HostAccess;
	/**
	 * Whether the Person's role in `spaceId`, or in another Space of the
	 * Person's, allows `permissions` (`roleAllows`). False without a
	 * session, or in a Space the Person is not a member of.
	 */
	can(permissions: Permissions, inSpace?: string): Promise<boolean>;
	/**
	 * The Person's role in a Space, from the memberships the request read.
	 * Null without a session, or in a Space the Person is not a member of.
	 */
	roleIn(spaceId: string): Promise<Role | null>;
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
	const personId = session?.user.id ?? null;

	// The Person's role in each of their Spaces, read once. A change of the
	// memberships through this request reads them again.
	let memberships: Promise<Space[]> | null = null;
	const spaces = () => {
		memberships ??= personId ? spacesOf(db, personId) : Promise.resolve([]);
		return memberships;
	};
	const changed = <T>(result: T): T => {
		memberships = null;
		return result;
	};

	const spaceId = session
		? await workingSpace(db, session.session, await spaces())
		: null;
	const inSpace = () => {
		if (!spaceId) {
			throw new Refusal("signed-out", "Sign in to use Night Shift.");
		}
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
		async can(permissions, inSpace) {
			const space = inSpace ?? spaceId;
			if (!space || !session) return false;
			const role = (await spaces()).find((s) => s.id === space)?.role;
			return role !== undefined && roleAllows(role, permissions);
		},
		async roleIn(space) {
			if (!session) return null;
			return (await spaces()).find((s) => s.id === space)?.role ?? null;
		},
		async setActiveSpace(id) {
			await auth.api
				.setActiveOrganization({
					headers: resolved.headers,
					body: { organizationId: id },
				})
				.catch(refuse);
		},
		members: {
			async invite(email, role) {
				const created = await auth.api
					.createInvitation({
						headers: resolved.headers,
						body: { email, role, organizationId: inSpace() },
					})
					.catch(refuse);
				return { id: created.id };
			},
			async cancelInvitation(invitationId) {
				await auth.api
					.cancelInvitation({
						headers: resolved.headers,
						body: { invitationId },
					})
					.catch(refuse);
			},
			async setRole(memberId, role) {
				await auth.api
					.updateMemberRole({
						headers: resolved.headers,
						body: { memberId, role, organizationId: inSpace() },
					})
					.catch(refuse)
					.then(changed);
			},
			async remove(memberId) {
				await auth.api
					.removeMember({
						headers: resolved.headers,
						body: { memberIdOrEmail: memberId, organizationId: inSpace() },
					})
					.catch(refuse)
					.then(changed);
			},
			async accept(invitationId) {
				const accepted = await auth.api
					.acceptInvitation({
						headers: resolved.headers,
						body: { invitationId },
					})
					.catch(refuse)
					.then(changed);
				if (!accepted) throw new Error("Could not accept the invitation.");
				return { spaceId: accepted.member.organizationId };
			},
		},
		async createSpace(name) {
			const created = await auth.api
				.createOrganization({
					headers: resolved.headers,
					body: { name, slug: `${slugOf(name)}-${randomUUID().slice(0, 8)}` },
				})
				.catch(refuse)
				.then(changed);
			if (!created) throw new Error("Could not create the Space.");
			return { id: created.id };
		},
	};
}

/**
 * The headers and the Host's decision for a call to Better Auth's own
 * endpoints, which read the session themselves. It reads the session only
 * when the decision needs it: a session from another computer, on a Host
 * that requires two-factor sign-in.
 */
export async function authEndpointAccess(
	auth: Auth,
	headers: Headers,
	local: LocalSession | null,
	policy: HostPolicy = OPEN_HOST,
): Promise<{ headers: Headers; hostAccess: HostAccess }> {
	if (local) {
		return {
			headers: await local.headers(headers),
			hostAccess: hostAccess(policy, { session: null, fromThisComputer: true }),
		};
	}
	const session = policy.requireTwoFactor
		? await auth.api.getSession({ headers })
		: null;
	return {
		headers,
		hostAccess: hostAccess(policy, { session, fromThisComputer: false }),
	};
}

/**
 * The Space a session works in: its active Space when the Person is still
 * a member of it, else their personal Space.
 */
async function workingSpace(
	db: Database,
	session: { userId: string; activeOrganizationId?: string | null },
	spaces: Space[],
): Promise<string> {
	const active = session.activeOrganizationId;
	if (active && spaces.some((s) => s.id === active)) return active;
	return (
		spaces.find((s) => s.personal)?.id ??
		(await ensurePersonalSpace(db, session.userId))
	);
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
