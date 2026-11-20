import type { Database } from "@nightshift/db";
import { user } from "@nightshift/db/schema";
import { eq, inArray, sql } from "drizzle-orm";
import type { PersonStore } from "../../application/ports";

/** `PersonStore` over the `user` table. `wireMembers` builds it. */
export function drizzlePersonStore(db: Database): PersonStore {
	return {
		async hasAnyone() {
			const [anyone] = await db.select({ id: user.id }).from(user).limit(1);
			return anyone !== undefined;
		},
		async hasRole(role) {
			const [row] = await db
				.select({ id: user.id })
				.from(user)
				.where(eq(user.role, role))
				.limit(1);
			return row !== undefined;
		},
		async roleOf(personId) {
			const [row] = await db
				.select({ role: user.role })
				.from(user)
				.where(eq(user.id, personId))
				.limit(1);
			return row?.role ?? null;
		},
		async setRole(personId, role) {
			await db.update(user).set({ role }).where(eq(user.id, personId));
		},
		async hasAccount(email) {
			const [account] = await db
				.select({ id: user.id })
				.from(user)
				.where(eq(sql`lower(${user.email})`, email))
				.limit(1);
			return account !== undefined;
		},
		async names(ids) {
			const rows = await db
				.select({ id: user.id, name: user.name })
				.from(user)
				.where(inArray(user.id, [...ids]));
			return new Map(rows.map((row) => [row.id, row.name]));
		},
		async contact(personId) {
			const [row] = await db
				.select({ name: user.name, email: user.email })
				.from(user)
				.where(eq(user.id, personId));
			return row ?? null;
		},
	};
}
