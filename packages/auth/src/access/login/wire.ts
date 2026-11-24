import type { Database } from "@nightshift/db";
import type { Auth } from "../../auth";
import { betterAuthCredentials } from "./adapters/out/better-auth-credentials";
import { drizzleSessionStore } from "./adapters/out/drizzle-session-store";
import { listLiveSessions } from "./application/list-live-sessions";
import { setLogin } from "./application/set-login";

/**
 * The wiring of login: the one place that builds its real adapters and
 * binds each use case to its ports.
 */

/** What the package gives login: what the real adapters stand on. */
export type LoginDeps = {
	auth: Auth;
	db: Database;
};

/** The use cases of login, bound to their ports, and the calls of a port that other slices make. */
export type Login = {
	/** Whether the Person can sign in with an email and a password. */
	hasLogin: (request: { personId: string }) => Promise<boolean>;
	/** Sets the Person's email, name and password. */
	setLogin: ReturnType<typeof setLogin>;
	/**
	 * Ends one of the Person's sessions: the screen that holds it is signed
	 * out at its next call. Removing a phone ends the session it signed in
	 * with. False when the Person has no session of that id.
	 */
	endSession: (request: {
		personId: string;
		sessionId: string;
	}) => Promise<boolean>;
	/** Which of these sessions still work. */
	listLiveSessions: ReturnType<typeof listLiveSessions>;
};

export function wireLogin(deps: LoginDeps): Login {
	const ports = {
		credentials: betterAuthCredentials(deps.auth, deps.db),
		sessionStore: drizzleSessionStore(deps.db),
	};
	return {
		hasLogin: ({ personId }) => ports.credentials.hasPassword(personId),
		setLogin: setLogin(ports),
		endSession: ({ personId, sessionId }) =>
			ports.sessionStore.end(personId, sessionId),
		listLiveSessions: listLiveSessions(ports),
	};
}
