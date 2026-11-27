import { existsSync } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { iso } from "@nightshift/time";
import { sql } from "drizzle-orm";

import type { Database } from "./client";

/**
 * Copies the whole database to `<folder>/before-<before>-<at>.db` in one
 * statement (`VACUUM INTO`), through the client of this process: never a
 * second connection to the file. Returns the path of the copy. Only a
 * database of this computer (a file, or memory) can be copied: any other
 * refuses before it writes. A copy that fails leaves no part of itself.
 */
export async function copyDatabase(
	db: Database,
	folder: string,
	before: string,
	at: number,
): Promise<string> {
	if (db.$client.protocol !== "file") {
		throw new Error(
			`Night Shift can copy only a database on this computer, not one over ${db.$client.protocol}.`,
		);
	}
	await mkdir(folder, { recursive: true });
	const stamp = iso(at).replace(/[:.]/g, "-");
	const path = join(folder, `before-${before}-${stamp}.db`);
	if (existsSync(path)) {
		throw new Error(`A copy of the database at ${path} is there already.`);
	}
	try {
		await db.run(sql.raw(`VACUUM INTO '${path.replaceAll("'", "''")}'`));
		const copy = await stat(path).catch(() => null);
		if (!copy || copy.size === 0) {
			throw new Error(`The copy of the database at ${path} was not made.`);
		}
	} catch (error) {
		await rm(path, { force: true });
		throw error;
	}
	return path;
}
