import type { Database } from "@nightshift/db";
import type { Auth } from "../auth";
import { betterAuthCredentials } from "./adapters/out/better-auth-credentials";
import { drizzleSessionStore } from "./adapters/out/drizzle-session-store";
import { endSession } from "./application/end-session";
import { hasLogin } from "./application/has-login";
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

/** The use cases of login, bound to their ports. */
export type Login = {
	/** Whether the Person can sign in with an email and a password. */
	hasLogin: ReturnType<typeof hasLogin>;
	/** Sets the Person's email, name and password. */
	setLogin: ReturnType<typeof setLogin>;
	/** Ends one of the Person's sessions. */
	endSession: ReturnType<typeof endSession>;
	/** Which of these sessions still work. */
	listLiveSessions: ReturnType<typeof listLiveSessions>;
};

export function wireLogin(deps: LoginDeps): Login {
	const ports = {
		credentials: betterAuthCredentials(deps.auth, deps.db),
		sessionStore: drizzleSessionStore(deps.db),
	};
	return {
		hasLogin: hasLogin(ports),
		setLogin: setLogin(ports),
		endSession: endSession(ports),
		listLiveSessions: listLiveSessions(ports),
	};
}
