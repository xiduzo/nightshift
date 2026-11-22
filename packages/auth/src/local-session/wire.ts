import type { Database } from "@nightshift/db";
import { now } from "@nightshift/time";
import type { Auth, Session } from "../auth";
import { betterAuthSessions } from "./adapters/out/better-auth-sessions";
import { findToken } from "./application/find-token";
import { pickHeaders } from "./application/pick-headers";
import { resolveSession } from "./application/resolve-session";
import { createTokenCell } from "./domain/local-token";

/**
 * The wiring of local-session: the one place that builds its real
 * adapters and binds each use case to its ports. One wire is one local
 * session: it keeps the session's token in memory between requests.
 */

/** What the package gives local-session: what the real adapters stand on, and whose session it is. */
export type LocalSessionDeps = {
	auth: Auth;
	db: Database;
	/** The Person of this computer. */
	personId: string;
};

/**
 * The local Person's session, for the requests from this computer that
 * carry no session of their own. The use cases of local-session, bound
 * to their ports and to the Person.
 */
export type LocalSession = {
	/**
	 * The request's session, else the local Person's, with the headers that
	 * carry it (`resolveSession`). Pass the headers on to Better Auth.
	 */
	resolve(
		headers: Headers,
	): Promise<{ session: Session | null; headers: Headers }>;
	/**
	 * The headers to pass on to Better Auth (`pickHeaders`): the request's
	 * own when it carries a live session, else with the local session's
	 * cookie. Reads no session without a cookie of the request's own.
	 */
	headers(headers: Headers): Promise<Headers>;
};

export function wireLocalSession(deps: LocalSessionDeps): LocalSession {
	const ports = {
		sessions: betterAuthSessions(deps.auth, deps.db),
		token: createTokenCell(),
		now,
	};
	const bound = { ...ports, findToken: findToken(ports) };
	const resolve = resolveSession(bound);
	const pick = pickHeaders(bound);
	const { personId } = deps;
	return {
		resolve: (headers) => resolve({ personId, headers }),
		headers: (headers) => pick({ personId, headers }),
	};
}
