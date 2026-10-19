import type { Database } from "@nightshift/db";

import type { Permissions } from "./access";
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
	/** The organization plugin's `hasPermission` for the session in `spaceId`. */
	can(permissions: Permissions): Promise<boolean>;
	/**
	 * Makes a Space the session's active one (the organization plugin's
	 * `setActiveOrganization`). Refused when the Person is not a member.
	 */
	setActiveSpace(spaceId: string): Promise<void>;
};

/**
 * Resolves a request's session and Space. `local` gives a request from
 * this computer without a session of its own the local Person's session;
 * pass null for any other request.
 */
export async function requestAccess(
	auth: Auth,
	db: Database,
	headers: Headers,
	local: LocalSession | null,
): Promise<RequestAccess> {
	const resolved = local
		? await local.resolve(headers)
		: { session: await auth.api.getSession({ headers }), headers };
	const { session } = resolved;
	const spaceId = session ? await activeSpaceId(db, session.session) : null;
	return {
		session,
		spaceId,
		headers: resolved.headers,
		can: (permissions) =>
			spaceId
				? hasPermission(auth, resolved.headers, spaceId, permissions)
				: Promise.resolve(false),
		async setActiveSpace(id) {
			await auth.api.setActiveOrganization({
				headers: resolved.headers,
				body: { organizationId: id },
			});
		},
	};
}
