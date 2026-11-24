import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { migratedDb } from "@nightshift/db/testing";
import { databaseCopyContract } from "./database-copy.contract";
import { fsDatabaseCopy } from "./fs-database-copy";
import { inMemoryDatabaseCopy } from "./in-memory-database-copy";

databaseCopyContract("in memory", () => inMemoryDatabaseCopy());

databaseCopyContract("fs vacuum", async () => {
	const dir = await mkdtemp(join(tmpdir(), "membership-copy-"));
	const dbPath = join(dir, "main.db");
	const db = await migratedDb(pathToFileURL(dbPath).href);
	const port = fsDatabaseCopy(db);
	return {
		async copy(_dataDir, at, before) {
			try {
				return await port.copy(dir, at, before);
			} finally {
				await rm(dir, { recursive: true, force: true }).catch(() => {});
			}
		},
	};
});
