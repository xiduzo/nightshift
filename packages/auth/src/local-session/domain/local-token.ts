/**
 * One person on one computer signs in to nothing: a request from this
 * computer without a session of its own acts in a real session of the
 * computer's Person (`localPerson`). The daemon decides which requests are
 * from this computer. This slice gives them the session.
 *
 * The session is an ordinary Better Auth session, so everything a session
 * does (its active Space, the organization plugin's endpoints, permission
 * checks) works the same. Its cookie is only ever added on the server, to
 * the request's headers.
 *
 * The session's token and expiry stay in memory: a request reads the
 * session once, through Better Auth, and never looks the token up first.
 */

/** A session as this slice reads it. The wire names Better Auth's full type. */
export type SessionOf = { session: { token: string; expiresAt: Date } };

/** A session's token, and when it expires (ms). */
export type LocalToken = { token: string; expiresAt: number };

/** The token of the local session, kept in memory between requests. */
export type TokenCell = {
	/** The token while it has not expired at `now`, else null. */
	live(now: number): string | null;
	/** Keeps `token`, and gives its value. */
	keep(token: LocalToken): string;
	/** Forgets the token: its session ended. */
	forget(): void;
};

export function createTokenCell(): TokenCell {
	let current: LocalToken | null = null;
	return {
		live: (now) => (current && current.expiresAt > now ? current.token : null),
		keep(token) {
			current = { token: token.token, expiresAt: token.expiresAt };
			return current.token;
		},
		forget() {
			current = null;
		},
	};
}
