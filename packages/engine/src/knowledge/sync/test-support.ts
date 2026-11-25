import { organization, project } from "@nightshift/db/schema";
import { migratedDb } from "@nightshift/db/testing";
import { asDate } from "@nightshift/time";
import { drizzleProjectSpaces } from "./adapters/out/drizzle-project-spaces";
import { inMemorySyncPorts } from "./adapters/out/in-memory-neighbours";
import type { ProjectSpaces } from "./application/ports";

/** The Spaces of the Projects over a database in memory: Project `p1` is in Space `s1`, which is not shared. */
async function projectSpaces(): Promise<ProjectSpaces> {
	const db = await migratedDb();
	await db.insert(organization).values({
		id: "s1",
		name: "s1",
		slug: "s1",
		personal: true,
		createdAt: asDate(0),
	});
	await db.insert(project).values({ id: "p1", spaceId: "s1", name: "p1" });
	return drizzleProjectSpaces(db);
}

/** The same Spaces at once: the database opens with the first read. */
export function lateProjectSpaces(): ProjectSpaces {
	let opened: Promise<ProjectSpaces> | undefined;
	const spaces = () => (opened ??= projectSpaces());
	return {
		spaceOf: async (projectId) => (await spaces()).spaceOf(projectId),
		isShared: async (spaceId) => (await spaces()).isShared(spaceId),
		projectsIn: async (spaceId) => (await spaces()).projectsIn(spaceId),
	};
}

/** Every port of knowledge/sync: where each use-case test starts. */
export async function syncPorts() {
	return { ...inMemorySyncPorts(), spaces: await projectSpaces() };
}
