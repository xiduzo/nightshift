import { organization, project } from "@nightshift/db/schema";
import { migratedDb } from "@nightshift/db/testing";
import { asDate } from "@nightshift/time";
import { drizzleProjectSpaces } from "./adapters/out/drizzle-project-spaces";
import { inMemorySyncPorts } from "./adapters/out/in-memory-neighbours";

/** Every port of knowledge/sync: where each use-case test starts. Project `p1` is in Space `s1`, rows of a database in memory. */
export async function syncPorts() {
	const db = await migratedDb();
	await db.insert(organization).values({
		id: "s1",
		name: "s1",
		slug: "s1",
		createdAt: asDate(0),
	});
	await db.insert(project).values({ id: "p1", spaceId: "s1", name: "p1" });
	return { ...inMemorySyncPorts(), spaces: drizzleProjectSpaces(db) };
}
