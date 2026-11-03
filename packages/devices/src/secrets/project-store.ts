import type { Database } from "@nightshift/db";
import { projectSecret } from "@nightshift/db/schema";
import { asDate, instant, now as timeNow } from "@nightshift/time";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { SecretsCipher } from "./cipher";

/** A Project secret as this computer keeps it: its name, when it was set and by whom. */
export type KeptProjectSecret = {
	name: string;
	setAt: number;
	/** The Person who set it last. Null: not known. */
	setBy: string | null;
};

/**
 * The Project secrets this computer keeps (ADR 13): for each Project of
 * a Space it keeps, as its Host or as a computer without one. Each value
 * is sealed at rest (`secretsCipher`), bound to `project:<id>` and its
 * name, so it never opens as another Project's or as a Personal secret.
 * It knows no access rule: the Host's half (`createProjectSecretsHost`)
 * and the Device's half (`deviceProjectSecrets`) decide who it serves.
 */
export type ProjectSecretStore = {
	list(projectId: string): Promise<KeptProjectSecret[]>;
	/**
	 * The values of these names that the Project keeps here, or every one
	 * without `names`. A value that does not open (the secrets key changed)
	 * is left out, and logged.
	 */
	values(
		projectId: string,
		names?: readonly string[],
	): Promise<Record<string, string>>;
	/** Saves or replaces a value. `setBy`: the Person who set it. */
	set(
		project: { spaceId: string; projectId: string },
		name: string,
		value: string,
		setBy: string,
	): Promise<void>;
	remove(projectId: string, name: string): Promise<void>;
};

/** What a value is bound to: whose it is, and its name. */
const boundOf = (projectId: string, name: string) =>
	`project:${projectId}\n${name}`;

export function createProjectSecretStore(deps: {
	db: Database;
	cipher: SecretsCipher;
	now?: () => number;
}): ProjectSecretStore {
	const { db, cipher } = deps;
	const now = deps.now ?? timeNow;
	return {
		async list(projectId) {
			const rows = await db
				.select({
					name: projectSecret.name,
					setAt: projectSecret.setAt,
					setBy: projectSecret.setBy,
				})
				.from(projectSecret)
				.where(eq(projectSecret.projectId, projectId))
				.orderBy(asc(projectSecret.name));
			return rows.map((row) => ({ ...row, setAt: instant(row.setAt) }));
		},
		async values(projectId, names) {
			if (names?.length === 0) return {};
			const rows = await db
				.select()
				.from(projectSecret)
				.where(
					and(
						eq(projectSecret.projectId, projectId),
						names
							? inArray(projectSecret.name, [...new Set(names)])
							: undefined,
					),
				);
			const out: Record<string, string> = {};
			for (const row of rows) {
				try {
					out[row.name] = await cipher.open(row, boundOf(projectId, row.name));
				} catch (error) {
					console.warn(
						`[secrets] the project secret ${row.name} does not open with this computer's secrets key:`,
						error,
					);
				}
			}
			return out;
		},
		async set({ spaceId, projectId }, name, value, setBy) {
			const sealed = await cipher.seal(value, boundOf(projectId, name));
			const values = { ...sealed, spaceId, setAt: asDate(now()), setBy };
			await db
				.insert(projectSecret)
				.values({ projectId, name, ...values })
				.onConflictDoUpdate({
					target: [projectSecret.projectId, projectSecret.name],
					set: values,
				});
		},
		async remove(projectId, name) {
			await db
				.delete(projectSecret)
				.where(
					and(
						eq(projectSecret.projectId, projectId),
						eq(projectSecret.name, name),
					),
				);
		},
	};
}
