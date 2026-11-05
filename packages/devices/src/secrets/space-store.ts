import type { Database } from "@nightshift/db";
import { spaceSecret } from "@nightshift/db/schema";
import { asDate, instant, now as timeNow } from "@nightshift/time";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { SecretsCipher } from "./cipher";
import type { KeptProjectSecret } from "./project-store";

/**
 * The Space secrets this computer keeps (ADR 18): for each Space it keeps,
 * as its Host or as a computer without one. Each value is sealed at rest,
 * bound to `space:<id>` and its name, so it never opens as another Space's
 * or as a secret of another scope. It knows no access rule.
 */
export type SpaceSecretStore = {
	list(spaceId: string): Promise<KeptProjectSecret[]>;
	/** The values of these names, or every one without `names`. One that does not open is left out, and logged. */
	values(
		spaceId: string,
		names?: readonly string[],
	): Promise<Record<string, string>>;
	set(
		spaceId: string,
		name: string,
		value: string,
		setBy: string,
	): Promise<void>;
	remove(spaceId: string, name: string): Promise<void>;
};

const boundOf = (spaceId: string, name: string) => `space:${spaceId}\n${name}`;

export function createSpaceSecretStore(deps: {
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
					out[row.name] = await cipher.open(row, boundOf(spaceId, row.name));
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
			const sealed = await cipher.seal(value, boundOf(spaceId, name));
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
