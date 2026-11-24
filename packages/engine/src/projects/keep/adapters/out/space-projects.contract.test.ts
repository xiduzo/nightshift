import { organization } from "@nightshift/db/schema";
import { migratedDb } from "@nightshift/db/testing";
import { asDate } from "@nightshift/time";
import { createSpaceDocuments } from "../../../../documents";
import { inMemorySpaceProjects } from "./in-memory-space-projects";
import { spaceProjectsContract } from "./space-projects.contract";
import { yjsSpaceProjects } from "./yjs-space-projects";

/**
 * The contract of `SpaceProjects`, on both adapters. The real adapter's
 * side runs on the Space documents over libsql in memory.
 */

spaceProjectsContract("in memory", async () => {
	const spaceProjects = inMemorySpaceProjects();
	spaceProjects.hostElsewhere("hosted");
	return {
		spaceProjects,
		async read(spaceId) {
			const document = spaceProjects.documentOf(spaceId);
			return {
				projects: Object.fromEntries(
					[...document.projects].map(([id, entry]) => [
						id,
						{ name: entry.name, removed: entry.removedAt !== null },
					]),
				),
				clones: document.clones
					.map((c) => `${c.projectId}/${c.deviceId}`)
					.sort(),
			};
		},
		close: async () => {},
	};
});

spaceProjectsContract("over the Space documents", async () => {
	const db = await migratedDb();
	for (const id of ["mine", "hosted"]) {
		await db
			.insert(organization)
			.values({ id, name: id, slug: id, createdAt: asDate(0) });
	}
	const documents = createSpaceDocuments({
		db,
		directory: {
			names: async () => new Map(),
			hostedElsewhere: async (spaceId) => spaceId === "hosted",
		},
	});
	return {
		spaceProjects: yjsSpaceProjects(documents),
		async read(spaceId) {
			const document = await documents.open(spaceId);
			const projects: Record<string, { name: string; removed: boolean }> = {};
			for (const [id, value] of document.projects.entries()) {
				const entry = value as { name: string; removedAt: number | null };
				projects[id] = { name: entry.name, removed: entry.removedAt !== null };
			}
			const clones = [...document.clones.values()]
				.map((value) => {
					const clone = value as { projectId: string; deviceId: string };
					return `${clone.projectId}/${clone.deviceId}`;
				})
				.sort();
			return { projects, clones };
		},
		close: async () => {
			await documents.flush();
		},
	};
});
