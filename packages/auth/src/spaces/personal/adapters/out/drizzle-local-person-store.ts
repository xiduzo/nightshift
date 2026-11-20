import type { Database } from "@nightshift/db";
import { user } from "@nightshift/db/schema";
import { eq } from "drizzle-orm";
import type { LocalPersonStore } from "../../application/ports";

/** `LocalPersonStore` over the `user` table. `wirePersonal` builds it. */
export function drizzleLocalPersonStore(db: Database): LocalPersonStore {
	return {
		async find(personId) {
			const [person] = await db
				.select()
				.from(user)
				.where(eq(user.id, personId));
			return person ?? null;
		},
		async findByEmail(email) {
			const [person] = await db
				.select()
				.from(user)
				.where(eq(user.email, email));
			return person ?? null;
		},
		async add(person) {
			await db.insert(user).values(person);
		},
		async rename(personId, name) {
			await db.update(user).set({ name }).where(eq(user.id, personId));
		},
	};
}
