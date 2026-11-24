import type { Database } from "@nightshift/db";
import { clone, device, organization, project } from "@nightshift/db/schema";
import { migratedDb } from "@nightshift/db/testing";
import { asDate } from "@nightshift/time";
import { eq, sql } from "drizzle-orm";
import type { RowBatch } from "../../contract";
import { drizzleProjectStore } from "./adapters/out/drizzle-project-store";
import {
	HERE,
	inMemoryIds,
	inMemoryProjectDirectory,
	inMemoryProjectLog,
	inMemoryRepos,
	inMemorySpaceHolds,
	inMemoryThisDevice,
} from "./adapters/out/in-memory-neighbours";
import { inMemorySpaceProjects } from "./adapters/out/in-memory-space-projects";
import type { ProjectRecord } from "./domain/project";

/** Runs the statements of a batch, as the log runs them with its event. */
export async function runBatch(db: Database, batch: RowBatch): Promise<void> {
	const [first, ...rest] = batch as unknown as Parameters<typeof db.batch>[0];
	if (first) await db.batch([first, ...rest]);
}

/**
 * Every shared port of the Projects: the rows of a database in memory, with
 * the Spaces `s1`, `s2` and `team` and this computer's Device, and the
 * others in memory. Where each use-case test starts.
 */
export async function keepPorts() {
	const db = await migratedDb();
	for (const id of ["s1", "s2", "team"]) {
		await db
			.insert(organization)
			.values({ id, name: id, slug: id, createdAt: asDate(0) });
	}
	await db.insert(device).values({ id: HERE, name: HERE, platform: "linux" });
	let rows = 0;
	return {
		store: drizzleProjectStore({ db, ...inMemoryThisDevice() }),
		/** Adds a project row, as another Replica's change or a migration left it. */
		async addProject(
			row: Pick<ProjectRecord, "id" | "spaceId" | "name"> &
				Partial<ProjectRecord>,
		) {
			await db.insert(project).values({ createdAt: asDate(++rows), ...row });
		},
		/** The Clones of every Device, oldest first. */
		clones: () => db.select().from(clone).orderBy(sql`rowid`),
		spaceProjects: inMemorySpaceProjects(
			undefined,
			async (spaceId, id, entry) => {
				const set = {
					name: entry.name,
					remote: entry.remote,
					folder: entry.folder,
					removedAt: entry.removedAt === null ? null : asDate(entry.removedAt),
				};
				// The row follows the entry of its Space document.
				await db
					.insert(project)
					.values({ id, spaceId, createdAt: asDate(++rows), ...set })
					.onConflictDoUpdate({
						target: project.id,
						set,
						where: eq(project.spaceId, spaceId),
					});
			},
		),
		projectLog: inMemoryProjectLog((batch) => runBatch(db, batch)),
		thisDevice: inMemoryThisDevice(),
		repos: inMemoryRepos(),
		directory: inMemoryProjectDirectory(),
		spaceHolds: inMemorySpaceHolds(),
		ids: inMemoryIds(),
	};
}
