import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "@nightshift/db";
import { sql } from "drizzle-orm";

/**
 * A copy of the whole database in the data directory, made in one
 * statement (`VACUUM INTO`): what a merge of the personal Spaces makes
 * before it changes anything, and a split when this computer leaves its
 * home Host. Its path names what follows (`before`) and the moment, so no
 * copy replaces another. Throws when the copy is not there after it.
 */
export async function backupDatabase(
	db: Database,
	dataDir: string,
	at: number,
	before: "personal-merge" | "leaving-host" = "personal-merge",
): Promise<string> {
	const folder = join(dataDir, "backups");
	await mkdir(folder, { recursive: true });
	const stamp = new Date(at).toISOString().replace(/[:.]/g, "-");
	const path = join(folder, `before-${before}-${stamp}.db`);
	await db.run(sql.raw(`VACUUM INTO '${path.replaceAll("'", "''")}'`));
	const copy = await stat(path).catch(() => null);
	if (!copy || copy.size === 0) {
		throw new Error(`The copy of the database at ${path} was not made.`);
	}
	return path;
}
