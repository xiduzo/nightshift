import { createDb } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";
import { clone, device, organization, project } from "@nightshift/db/schema";
import { asDate } from "@nightshift/time";
import { eq } from "drizzle-orm";
import { drizzleProjectStore } from "./drizzle-project-store";
import {
	inMemoryProjectStore,
	projectRecords,
} from "./in-memory-project-store";
import { projectStoreContract } from "./project-store.contract";

/**
 * The contract of `ProjectStore`, on both adapters. The real adapter's
 * side runs on libsql in memory.
 */

projectStoreContract("in memory", async () => {
	const store = inMemoryProjectStore(projectRecords("here"));
	return {
		store,
		seed: {
			async project(row) {
				store.records.projects.set(row.id, row);
			},
			async clone(projectId, deviceId, path) {
				const spaceId = store.records.projects.get(projectId)?.spaceId ?? "";
				store.records.clones.push({
					id: `${projectId}@${deviceId}`,
					spaceId,
					projectId,
					deviceId,
					path,
				});
			},
		},
		run: async (batch) => store.apply(batch),
		clones: async () =>
			store.records.clones
				.map((c) => `${c.projectId}@${c.deviceId}:${c.path}`)
				.sort(),
		close: async () => {},
	};
});

projectStoreContract("over drizzle", async () => {
	const db = createDb({ DATABASE_URL: ":memory:" });
	await migrateDb(db);
	for (const id of ["s1", "s2"]) {
		await db
			.insert(organization)
			.values({ id, name: id, slug: id, createdAt: asDate(0) });
	}
	for (const id of ["here", "studio"]) {
		await db.insert(device).values({ id, name: id, platform: "linux" });
	}
	return {
		store: drizzleProjectStore({ db, deviceId: async () => "here" }),
		seed: {
			async project(row) {
				await db.insert(project).values(row);
			},
			async clone(projectId, deviceId, path) {
				const [kept] = await db
					.select()
					.from(project)
					.where(eq(project.id, projectId));
				await db.insert(clone).values({
					id: `${projectId}@${deviceId}`,
					spaceId: kept?.spaceId ?? "s1",
					projectId,
					deviceId,
					path,
				});
			},
		},
		async run(batch) {
			const [first, ...rest] = batch as unknown as Parameters<
				typeof db.batch
			>[0];
			if (first) await db.batch([first, ...rest]);
		},
		clones: async () =>
			(await db.select().from(clone))
				.map((c) => `${c.projectId}@${c.deviceId}:${c.path}`)
				.sort(),
		close: async () => {},
	};
});
