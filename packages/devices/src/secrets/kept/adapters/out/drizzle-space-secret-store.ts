import type { Database } from "@nightshift/db";
import { spaceSecret } from "@nightshift/db/schema";
import { asDate, instant, now as timeNow } from "@nightshift/time";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { SecretsCipher, SpaceSecretStore } from "../../application/ports";
import { spaceBound } from "../../domain/kept-secret";

/** The Space secrets this computer keeps, in `space_secret`, each value sealed by `cipher`. */
export function drizzleSpaceSecretStore(deps: {
	db: Database;
	cipher: SecretsCipher;
	now?: () => number;
}): SpaceSecretStore {
	const { db, cipher } = deps;
	const now = deps.now ?? timeNow;
	return {
		async list(spaceId) {
			const rows = await db
				.select({
					name: spaceSecret.name,
					setAt: spaceSecret.setAt,
					setBy: spaceSecret.setBy,
				})
				.from(spaceSecret)
				.where(eq(spaceSecret.spaceId, spaceId))
				.orderBy(asc(spaceSecret.name));
			return rows.map((row) => ({ ...row, setAt: instant(row.setAt) }));
		},
		async values(spaceId, names) {
			if (names?.length === 0) return {};
			const rows = await db
				.select()
				.from(spaceSecret)
				.where(
					and(
						eq(spaceSecret.spaceId, spaceId),
						names ? inArray(spaceSecret.name, [...new Set(names)]) : undefined,
					),
				);
			const out: Record<string, string> = {};
			for (const row of rows) {
				try {
					out[row.name] = await cipher.open(row, spaceBound(spaceId, row.name));
				} catch (error) {
					console.warn(
						`[secrets] the Space secret ${row.name} does not open with this computer's secrets key:`,
						error,
					);
				}
			}
			return out;
		},
		async set(spaceId, name, value, setBy) {
			const sealed = await cipher.seal(value, spaceBound(spaceId, name));
			const values = { ...sealed, setAt: asDate(now()), setBy };
			await db
				.insert(spaceSecret)
				.values({ spaceId, name, ...values })
				.onConflictDoUpdate({
					target: [spaceSecret.spaceId, spaceSecret.name],
					set: values,
				});
		},
		async remove(spaceId, name) {
			await db
				.delete(spaceSecret)
				.where(
					and(eq(spaceSecret.spaceId, spaceId), eq(spaceSecret.name, name)),
				);
		},
	};
}
