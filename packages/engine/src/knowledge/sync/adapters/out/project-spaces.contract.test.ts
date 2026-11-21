import { createDb } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";
import { organization, project } from "@nightshift/db/schema";
import { asDate } from "@nightshift/time";
import { drizzleProjectSpaces } from "./drizzle-project-spaces";
import { inMemoryProjectSpaces } from "./in-memory-project-spaces";
import { projectSpacesContract } from "./project-spaces.contract";

/**
 * The contract of `ProjectSpaces`, on both adapters. The real side runs
 * on libsql in memory: `createDb({ DATABASE_URL: ":memory:" })` with
 * `migrateDb`.
 */

projectSpacesContract("in memory", async () => {
	const spaces = inMemoryProjectSpaces();
	spaces.add("p1", "s1");
	spaces.add("p2", "s1");
	spaces.add("p3", "s2");
	spaces.share("s1");
	return { projectSpaces: spaces, close: async () => {} };
});

projectSpacesContract("over drizzle", async () => {
	const db = createDb({ DATABASE_URL: ":memory:" });
	await migrateDb(db);
	await db.insert(organization).values([
		{ id: "s1", name: "s1", slug: "s1", createdAt: asDate(0) },
		{ id: "s2", name: "s2", slug: "s2", createdAt: asDate(0), personal: true },
	]);
	await db.insert(project).values([
		{ id: "p1", spaceId: "s1", name: "p1" },
		{ id: "p2", spaceId: "s1", name: "p2", removedAt: asDate(0) },
		{ id: "p3", spaceId: "s2", name: "p3" },
	]);
	return { projectSpaces: drizzleProjectSpaces(db), close: async () => {} };
});
