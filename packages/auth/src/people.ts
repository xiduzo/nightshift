import type { Database } from "@nightshift/db";
import { user } from "@nightshift/db/schema";
import { eq, inArray } from "drizzle-orm";

/**
 * Persons as their accounts on this Replica store them: what another
 * package needs to know of a Person without a request. The `user` table is
 * this package's. The engine asks here, it does not query it.
 */

/** The names of these Persons, by id. A Person this Replica does not know is missing. */
export async function personNames(
	db: Database,
	ids: readonly string[],
): Promise<Map<string, string>> {
	if (ids.length === 0) return new Map();
	const rows = await db
		.select({ id: user.id, name: user.name })
		.from(user)
		.where(inArray(user.id, [...ids]));
	return new Map(rows.map((row) => [row.id, row.name]));
}

/** The name and email of a Person, or null for one this Replica does not know. */
export async function personContact(
	db: Database,
	personId: string,
): Promise<{ name: string; email: string } | null> {
	const [row] = await db
		.select({ name: user.name, email: user.email })
		.from(user)
		.where(eq(user.id, personId));
	return row ?? null;
}
