import type { Database } from "@nightshift/db";
import { session } from "@nightshift/db/schema";
import { asDate } from "@nightshift/time";
import { and, eq, gt, inArray } from "drizzle-orm";
import type { SessionStore } from "../../application/ports";

/**
 * `SessionStore` over the `session` table. `wireLogin` builds it. Until
 * A4 a caller may wire login without a database: a call then fails.
 */
export function drizzleSessionStore(given: Database | undefined): SessionStore {
	const rows = () => {
		if (!given) throw new Error("This login was wired without a database.");
		return given;
	};
	return {
		async end(personId, sessionId) {
			const db = rows();
			const ended = await db
				.delete(session)
				.where(and(eq(session.id, sessionId), eq(session.userId, personId)))
				.returning({ id: session.id });
			return ended.length > 0;
		},
		async live(sessionIds, at) {
			if (sessionIds.length === 0) return new Set();
			const db = rows();
			const live = await db
				.select({ id: session.id })
				.from(session)
				.where(
					and(
						inArray(session.id, [...sessionIds]),
						gt(session.expiresAt, asDate(at)),
					),
				);
			return new Set(live.map((row) => row.id));
		},
	};
}
