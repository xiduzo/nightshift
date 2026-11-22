import { Refusal } from "@nightshift/refusal";
import {
	type HostAccess,
	type HostPolicy,
	hostAccess,
} from "../../host-access";
import {
	type Permissions,
	type Role,
	roleAllows,
	type Space,
} from "../../spaces";
import { type SessionOf, SIGNED_OUT } from "../domain/space-access";
import { spaceSlug } from "../domain/space-slug";
import type {
	LocalSessions,
	MemberSpaces,
	Organizations,
	SessionReader,
} from "./ports";

/**
 * Who a request is, in which Space, and what they may do there. It reads
 * the session and the Person's memberships once, when the request starts,
 * and answers `can` from the role it has, in memory.
 */
export type RequestAccessOf<S> = {
	session: S | null;
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

export type OpenRequestPorts<S> = {
	sessionReader: SessionReader<S>;
	members: Pick<MemberSpaces, "spacesOf" | "ensurePersonalSpace">;
	organizations: Organizations;
	/** A random id: the slug of a new Space takes its first 8 characters. */
	newId: () => string;
};

/**
 * A request: its headers, the local session when it comes from this
 * computer (null for any other request), and the Host's rules for
 * sessions from other computers.
 */
export type OpenRequest<S> = {
	headers: Headers;
	local: LocalSessions<S> | null;
	policy: HostPolicy;
};

/**
 * Resolves a request's session and Space. A request from this computer
 * without a session of its own gets the local Person's session.
 */
export const openRequest =
	<S extends SessionOf>(ports: OpenRequestPorts<S>) =>
	async (request: OpenRequest<S>): Promise<RequestAccessOf<S>> => {
		const { local, policy } = request;
		const resolved = local
			? await local.resolve(request.headers)
			: {
					session: await ports.sessionReader.read(request.headers),
					headers: request.headers,
				};
		const { session } = resolved;
		const personId = session?.user.id ?? null;
		const { organizations } = ports;

		// The Person's role in each of their Spaces, read once. A change of the
		// memberships through this request reads them again.
		let memberships: Promise<Space[]> | null = null;
		const spaces = () => {
			memberships ??= personId
				? ports.members.spacesOf(personId)
				: Promise.resolve([]);
			return memberships;
		};
		const changed = <T>(result: T): T => {
			memberships = null;
			return result;
		};

		const spaceId = session
			? await workingSpace(ports, session.session, await spaces())
			: null;
		const inSpace = () => {
			if (!spaceId) {
				throw new Refusal("signed-out", SIGNED_OUT.message);
			}
			return spaceId;
		};
		const headers = resolved.headers;
		return {
			session,
			spaceId,
			headers,
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
				await organizations.setActive(headers, id);
			},
			members: {
				async invite(email, role) {
					const created = await organizations.invite(headers, {
						email,
						role,
						spaceId: inSpace(),
					});
					return { id: created.id };
				},
				async cancelInvitation(invitationId) {
					await organizations.cancelInvitation(headers, invitationId);
				},
				async setRole(memberId, role) {
					await organizations
						.setRole(headers, { memberId, role, spaceId: inSpace() })
						.then(changed);
				},
				async remove(memberId) {
					await organizations
						.remove(headers, { memberId, spaceId: inSpace() })
						.then(changed);
				},
				async accept(invitationId) {
					const accepted = await organizations
						.accept(headers, invitationId)
						.then(changed);
					if (!accepted) throw new Error("Could not accept the invitation.");
					return { spaceId: accepted.spaceId };
				},
			},
			async createSpace(name) {
				const created = await organizations
					.create(headers, {
						name,
						slug: spaceSlug(name, ports.newId().slice(0, 8)),
					})
					.then(changed);
				if (!created) throw new Error("Could not create the Space.");
				return { id: created.id };
			},
		};
	};

/**
 * The Space a session works in: its active Space when the Person is still
 * a member of it, else their personal Space.
 */
async function workingSpace(
	ports: Pick<OpenRequestPorts<unknown>, "members">,
	session: SessionOf["session"],
	spaces: Space[],
): Promise<string> {
	const active = session.activeOrganizationId;
	if (active && spaces.some((s) => s.id === active)) return active;
	return (
		spaces.find((s) => s.personal)?.id ??
		(await ports.members.ensurePersonalSpace(session.userId))
	);
}
