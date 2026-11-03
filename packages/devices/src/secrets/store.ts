import type { Database } from "@nightshift/db";
import { personalSecret } from "@nightshift/db/schema";
import { asDate, instant, now as timeNow } from "@nightshift/time";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { PersonalSecretName } from "../contract";
import type { SecretsCipher } from "./cipher";

/**
 * The Personal secrets this computer keeps (ADR 13): for each Person whose
 * Home Host it is, and for its own owner when it has no Home Host. Each
 * value is sealed at rest (`secretsCipher`), bound to its owner and name.
 * It knows no access rule: the Host's half (`createPersonalSecretsHost`)
 * and the Device's half (`devicePersonalSecrets`) decide who it serves.
 */
export type PersonalSecretStore = {
	list(ownerId: string): Promise<PersonalSecretName[]>;
	/**
	 * The values of these names that the Person keeps here. A value that
	 * does not open (the secrets key changed) is left out, and logged.
	 */
	values(
		ownerId: string,
		names: readonly string[],
	): Promise<Record<string, string>>;
	/** Saves or replaces a value. `setBy`: the Device that set it. */
	set(
		ownerId: string,
		name: string,
		value: string,
		setBy: string | null,
	): Promise<void>;
	remove(ownerId: string, name: string): Promise<void>;
};

/** What a value is bound to: whose it is, and its name. */
const boundOf = (ownerId: string, name: string) => `${ownerId}\n${name}`;

export function createPersonalSecretStore(deps: {
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
					out[row.name] = await cipher.open(row, boundOf(ownerId, row.name));
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
			const sealed = await cipher.seal(value, boundOf(ownerId, name));
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
