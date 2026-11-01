import type { Database } from "@nightshift/db";
import { session as sessionTable } from "@nightshift/db/schema";
import { asDate, instant, now } from "@nightshift/time";
import { parseCookies, setRequestCookie } from "better-auth/cookies";
import { makeSignature } from "better-auth/crypto";
import { and, desc, eq, gt } from "drizzle-orm";
import type { Auth, Session } from "../auth";

/**
 * One person on one computer signs in to nothing: a request from this
 * computer without a session of its own acts in a real session of the
 * computer's Person (`localPerson`). The daemon decides which requests are
 * from this computer; this module gives them the session.
 *
 * The session is an ordinary Better Auth session, so everything a session
 * does (its active Space, the organization plugin's endpoints, permission
 * checks) works the same. Its cookie is only ever added on the server, to
 * the request's headers.
 *
 * The session's token and expiry stay in memory: a request reads the
 * session once, through Better Auth, and never looks the token up first.
 */
export type LocalSession = {
	/**
	 * The request's session, else the local Person's, with the headers that
	 * carry it. Pass the headers on to Better Auth.
	 */
	resolve(
		headers: Headers,
	): Promise<{ session: Session | null; headers: Headers }>;
	/**
	 * The headers to pass on to Better Auth: the request's own when it
	 * carries a live session, else with the local session's cookie. Reads
	 * no session without a cookie of the request's own.
	 */
	headers(headers: Headers): Promise<Headers>;
};

export function createLocalSession(
	auth: Auth,
	db: Database,
	personId: string,
): LocalSession {
	let current: { token: string; expiresAt: number } | null = null;

	/** An unexpired session of the Person, else a new one. */
	async function currentToken(): Promise<string> {
		if (current && current.expiresAt > now()) return current.token;
		const [latest] = await db
			.select({ token: sessionTable.token, expiresAt: sessionTable.expiresAt })
			.from(sessionTable)
			.where(
				and(
					eq(sessionTable.userId, personId),
					gt(sessionTable.expiresAt, asDate()),
				),
			)
			.orderBy(desc(sessionTable.expiresAt))
			.limit(1);
		const found =
			latest ??
			(await (await auth.$context).internalAdapter.createSession(personId));
		current = { token: found.token, expiresAt: instant(found.expiresAt) };
		return current.token;
	}

	async function withLocalCookie(headers: Headers): Promise<Headers> {
		const context = await auth.$context;
		const value = await currentToken();
		const signed = `${value}.${await makeSignature(value, context.secret)}`;
		const local = new Headers(headers);
		setRequestCookie(local, context.authCookies.sessionToken.name, signed);
		return local;
	}

	/** Whether the request carries a session cookie of its own. */
	async function hasOwnCookie(headers: Headers): Promise<boolean> {
		const cookie = headers.get("cookie");
		if (!cookie) return false;
		const name = (await auth.$context).authCookies.sessionToken.name;
		return parseCookies(cookie).has(name);
	}

	/** The local Person's session. A session that ended (signed out) gives way to a new one, once. */
	async function localSession(
		headers: Headers,
		retry = true,
	): Promise<{ session: Session | null; headers: Headers }> {
		const local = await withLocalCookie(headers);
		const session = await auth.api.getSession({ headers: local });
		if (session) {
			current = {
				token: session.session.token,
				expiresAt: instant(session.session.expiresAt),
			};
			return { session, headers: local };
		}
		current = null;
		return retry
			? localSession(headers, false)
			: { session: null, headers: local };
	}

	return {
		async resolve(headers) {
			if (await hasOwnCookie(headers)) {
				const own = await auth.api.getSession({ headers });
				if (own) return { session: own, headers };
			}
			return localSession(headers);
		},
		async headers(headers) {
			const own =
				(await hasOwnCookie(headers)) &&
				(await auth.api.getSession({ headers })) !== null;
			return own ? headers : withLocalCookie(headers);
		},
	};
}
