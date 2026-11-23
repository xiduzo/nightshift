import type { Database } from "@nightshift/db";
import { personalSecret } from "@nightshift/db/schema";
import { asDate, instant, now as timeNow } from "@nightshift/time";
import { and, asc, eq, inArray } from "drizzle-orm";
import type {
	PersonalSecretStore,
	SecretsCipher,
} from "../../application/ports";
import { personalBound } from "../../domain/kept-secret";

/** The Personal secrets this computer keeps, in `personal_secret`, each value sealed by `cipher`. */
export function drizzlePersonalSecretStore(deps: {
	db: Database;
	cipher: SecretsCipher;
	now?: () => number;
}): PersonalSecretStore {
	const { db, cipher } = deps;
	const now = deps.now ?? timeNow;
	return {
		async list(ownerId) {
			const rows = await db
				.select({ name: personalSecret.name, setAt: personalSecret.setAt })
				.from(personalSecret)
				.where(eq(personalSecret.ownerId, ownerId))
				.orderBy(asc(personalSecret.name));
			return rows.map((row) => ({ name: row.name, setAt: instant(row.setAt) }));
		},
		async values(ownerId, names) {
			if (names.length === 0) return {};
			const rows = await db
				.select()
				.from(personalSecret)
				.where(
					and(
						eq(personalSecret.ownerId, ownerId),
						inArray(personalSecret.name, [...new Set(names)]),
					),
				);
			const out: Record<string, string> = {};
			for (const row of rows) {
				try {
					out[row.name] = await cipher.open(
						row,
						personalBound(ownerId, row.name),
					);
				} catch (error) {
					console.warn(
						`[secrets] the Personal secret ${row.name} does not open with this computer's secrets key:`,
						error,
					);
				}
			}
			return out;
		},
		async set(ownerId, name, value, setBy) {
			const sealed = await cipher.seal(value, personalBound(ownerId, name));
			const values = { ...sealed, setAt: asDate(now()), setBy };
			await db
				.insert(personalSecret)
				.values({ ownerId, name, ...values })
				.onConflictDoUpdate({
					target: [personalSecret.ownerId, personalSecret.name],
					set: values,
				});
		},
		async remove(ownerId, name) {
			await db
				.delete(personalSecret)
				.where(
					and(
						eq(personalSecret.ownerId, ownerId),
						eq(personalSecret.name, name),
					),
				);
		},
	};
}
