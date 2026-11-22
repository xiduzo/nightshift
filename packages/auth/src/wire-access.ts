import type { Database } from "@nightshift/db";
import { now } from "@nightshift/time";
import {
	type RequestAccess,
	type SyncAuthorize,
	type SyncSetup,
	wireAccess,
} from "./access";
import type { Auth } from "./auth";
import { type HostAccess, type HostPolicy, OPEN_HOST } from "./host-access";
import { type LocalSession, wireLocalSession } from "./local-session";
import { type LoginInput, wireLogin } from "./login";

/**
 * The access of a request, the local session and the logins, for the
 * callers that hand over the Better Auth instance and the database per
 * call. Each function wires the slice for that call and runs one of its
 * use cases (`access/`, `local-session/`, `login/`). Lane A4 switches the
 * callers to one wire each and removes these.
 */

/**
 * Resolves a request's session and Space. `local` gives a request from
 * this computer without a session of its own the local Person's session:
 * pass null for any other request. `policy` is the Host's rules for
 * sessions from other computers.
 */
export function requestAccess(
	auth: Auth,
	db: Database,
	headers: Headers,
	local: LocalSession | null,
	policy: HostPolicy = OPEN_HOST,
): Promise<RequestAccess> {
	return wireAccess({ auth, db }).openRequest({ headers, local, policy });
}

/**
 * The headers and the Host's decision for a call to Better Auth's own
 * endpoints, which read the session themselves. It reads the session only
 * when the decision needs it: a session from another computer, on a Host
 * that requires two-factor sign-in.
 */
export function authEndpointAccess(
	auth: Auth,
	headers: Headers,
	local: LocalSession | null,
	policy: HostPolicy = OPEN_HOST,
): Promise<{ headers: Headers; hostAccess: HostAccess }> {
	return wireAccess({ auth }).openAuthEndpoint({
		headers,
		local,
		policy,
	});
}

/** Who may open which synced document: `authorizeDocument` of `access/`. */
export function documentAccess(
	options: { auth: Auth; db: Database } & Omit<SyncSetup, "policy"> & {
			policy?: HostPolicy;
		},
): SyncAuthorize {
	const { auth, db, ...setup } = options;
	return wireAccess({ auth, db }).authorizeDocuments(setup);
}

/** The local Person's session, for the requests from this computer without one of their own. */
export function createLocalSession(
	auth: Auth,
	db: Database,
	personId: string,
): LocalSession {
	return wireLocalSession({ auth, db, personId });
}

/** Whether the Person can sign in with an email and a password. */
export function hasLogin(db: Database, personId: string): Promise<boolean> {
	return wireLogin({ db }).hasLogin({ personId });
}

/** Sets the Person's email (and name), and their password: a new one, or in place of the old. */
export function setLogin(
	auth: Auth,
	personId: string,
	input: LoginInput,
): Promise<{ email: string }> {
	return wireLogin({ auth }).setLogin({ personId, input });
}

/**
 * Ends one of the Person's sessions: the screen that holds it is signed
 * out at its next call. False when the Person has no session of that id.
 */
export function endSession(
	db: Database,
	personId: string,
	sessionId: string,
): Promise<boolean> {
	return wireLogin({ db }).endSession({ personId, sessionId });
}

/**
 * Which of these sessions still work: the session exists and has not
 * expired. A phone's push target lives as long as its session.
 */
export function liveSessionIds(
	db: Database,
	sessionIds: readonly string[],
	at: number = now(),
): Promise<Set<string>> {
	return wireLogin({ db }).listLiveSessions({ sessionIds, at });
}
