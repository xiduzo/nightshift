import type { Database } from "@nightshift/db";
import { session as sessionTable } from "@nightshift/db/schema";
import { setRequestCookie } from "better-auth/cookies";
import { makeSignature } from "better-auth/crypto";
import { and, desc, eq, gt } from "drizzle-orm";

import type { Auth, Session } from "./index";

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
 */
export type LocalSession = {
	/**
	 * The request's session, else the local Person's, with the headers that
	 * carry it. Pass the headers on to Better Auth.
	 */
	resolve(
		headers: Headers,
	): Promise<{ session: Session | null; headers: Headers }>;
};

export function createLocalSession(
	auth: Auth,
	db: Database,
	personId: string,
): LocalSession {
	let token: string | null = null;

	/** An unexpired session of the Person, else a new one. */
	async function currentToken(): Promise<string> {
		const context = await auth.$context;
		if (token) {
			const found = await context.internalAdapter.findSession(token);
			if (found && found.session.expiresAt.getTime() > Date.now()) {
				return token;
			}
		}
		const [latest] = await db
			.select({ token: sessionTable.token })
			.from(sessionTable)
			.where(
				and(
					eq(sessionTable.userId, personId),
					gt(sessionTable.expiresAt, new Date()),
				),
			)
			.orderBy(desc(sessionTable.expiresAt))
			.limit(1);
		token =
			latest?.token ??
			(await context.internalAdapter.createSession(personId)).token;
		return token;
	}

	async function withLocalCookie(headers: Headers): Promise<Headers> {
		const context = await auth.$context;
		const value = await currentToken();
		const signed = `${value}.${await makeSignature(value, context.secret)}`;
		const local = new Headers(headers);
		setRequestCookie(local, context.authCookies.sessionToken.name, signed);
		return local;
	}

	return {
		async resolve(headers) {
			const own = await auth.api.getSession({ headers });
			if (own) return { session: own, headers };
			const local = await withLocalCookie(headers);
			return {
				session: await auth.api.getSession({ headers: local }),
				headers: local,
			};
		},
	};
}
