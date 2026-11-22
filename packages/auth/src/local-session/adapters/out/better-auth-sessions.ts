import type { Database } from "@nightshift/db";
import { session as sessionTable } from "@nightshift/db/schema";
import { asDate, instant } from "@nightshift/time";
import { parseCookies, setRequestCookie } from "better-auth/cookies";
import { makeSignature } from "better-auth/crypto";
import { and, desc, eq, gt } from "drizzle-orm";
import type { Auth, Session } from "../../../auth";
import type { Sessions } from "../../application/ports";

/**
 * `Sessions` over Better Auth: its session reader, its signed session
 * cookie and its internal adapter. The newest session is one read of the
 * `session` table. `wireLocalSession` builds it.
 */
export function betterAuthSessions(
	auth: Auth,
	db: Database,
): Sessions<Session> {
	return {
		read: (headers) => auth.api.getSession({ headers }),
		async hasCookie(headers) {
			const cookie = headers.get("cookie");
			if (!cookie) return false;
			const name = (await auth.$context).authCookies.sessionToken.name;
			return parseCookies(cookie).has(name);
		},
		async withCookie(headers, token) {
			const context = await auth.$context;
			const signed = `${token}.${await makeSignature(token, context.secret)}`;
			const local = new Headers(headers);
			setRequestCookie(local, context.authCookies.sessionToken.name, signed);
			return local;
		},
		async latest(personId, at) {
			const [latest] = await db
				.select({
					token: sessionTable.token,
					expiresAt: sessionTable.expiresAt,
				})
				.from(sessionTable)
				.where(
					and(
						eq(sessionTable.userId, personId),
						gt(sessionTable.expiresAt, asDate(at)),
					),
				)
				.orderBy(desc(sessionTable.expiresAt))
				.limit(1);
			return latest
				? { token: latest.token, expiresAt: instant(latest.expiresAt) }
				: null;
		},
		async create(personId) {
			const created = await (await auth.$context).internalAdapter.createSession(
				personId,
			);
			return { token: created.token, expiresAt: instant(created.expiresAt) };
		},
	};
}
