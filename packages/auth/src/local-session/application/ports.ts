import type { LocalToken } from "../domain/local-token";

/**
 * The driven ports of local-session. A port of its own has a real
 * adapter, an in-memory adapter and a contract suite in `adapters/out/`.
 */

/**
 * The sessions Better Auth keeps, and the cookie that carries one. `S` is
 * the session as Better Auth reads it: the wire names the full type.
 */
export type Sessions<S> = {
	/** The live session the headers carry, else null. */
	read(headers: Headers): Promise<S | null>;
	/** Whether the headers carry a session cookie of their own. */
	hasCookie(headers: Headers): Promise<boolean>;
	/** A copy of the headers that carries the session of `token`, signed. */
	withCookie(headers: Headers, token: string): Promise<Headers>;
	/** The Person's session that expires last, when it has not expired at `at`. Else null. */
	latest(personId: string, at: number): Promise<LocalToken | null>;
	/** A new session of the Person. */
	create(personId: string): Promise<LocalToken>;
};
