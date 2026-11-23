import type { Database } from "@nightshift/db";
import { projectSecret } from "@nightshift/db/schema";
import { asDate, instant, now as timeNow } from "@nightshift/time";
import { and, asc, eq, inArray } from "drizzle-orm";
import type {
	ProjectSecretStore,
	SecretsCipher,
} from "../../application/ports";
import { projectBound } from "../../domain/kept-secret";

/** The Project secrets this computer keeps, in `project_secret`, each value sealed by `cipher`. */
export function drizzleProjectSecretStore(deps: {
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
					out[row.name] = await cipher.open(
						row,
						projectBound(projectId, row.name),
					);
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
			const sealed = await cipher.seal(value, projectBound(projectId, name));
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
