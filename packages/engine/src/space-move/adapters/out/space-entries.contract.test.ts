import { organization } from "@nightshift/db/schema";
import { migratedDb } from "@nightshift/db/testing";
import { asDate } from "@nightshift/time";
import { eq } from "drizzle-orm";
import {
	createSpaceDocuments,
	recordClone,
	type SpaceProject,
} from "../../../documents";
import {
	entryRecords,
	inMemorySpaceEntries,
	type MemoryDocument,
} from "./in-memory-space-entries";
import { spaceEntriesContract } from "./space-entries.contract";
import { yjsSpaceEntries } from "./yjs-space-entries";

/**
 * The contract of `SpaceEntries`, on both adapters. The real adapter's
 * side runs on the Space documents over libsql in memory.
 */

const SPACES = ["from", "to", "other"];

spaceEntriesContract("in memory", async () => {
	const records = entryRecords();
	const documentOf = (spaceId: string): MemoryDocument => {
		const document = records.documents.get(spaceId) ?? {
			projects: new Map(),
			clones: [],
		};
		records.documents.set(spaceId, document);
		return document;
	};
	return {
		spaceEntries: inMemorySpaceEntries(records),
		seed: {
			async entry(spaceId, projectId, name) {
				documentOf(spaceId).projects.set(projectId, { name, remote: null });
			},
			async clone(spaceId, projectId, deviceId) {
				documentOf(spaceId).clones.push([projectId, deviceId]);
			},
		},
		dropSpace: async () => {},
		async read(spaceId) {
			const document = records.documents.get(spaceId);
			return {
				projects: Object.fromEntries(
					[...(document?.projects ?? [])].map(([id, e]) => [id, e.name]),
				),
				clones: (document?.clones ?? []).map(([p, d]) => `${p}/${d}`),
			};
		},
		close: async () => {},
	};
});

spaceEntriesContract("over the Space documents", async () => {
	const db = await migratedDb();
	for (const id of SPACES) {
		await db
			.insert(organization)
			.values({ id, name: id, slug: id, createdAt: asDate(0) });
	}
	const documents = createSpaceDocuments({
		db,
		directory: {
			names: async () => new Map(),
			hostedElsewhere: async () => false,
		},
	});
	return {
		spaceEntries: yjsSpaceEntries(documents),
		seed: {
			async entry(spaceId, projectId, name) {
				const document = await documents.open(spaceId);
				await document.change(() => {
					document.projects.set(projectId, {
						name,
						remote: null,
						folder: true,
						createdAt: 0,
						removedAt: null,
						updatedAt: 0,
					} satisfies SpaceProject);
				});
			},
			async clone(spaceId, projectId, deviceId) {
				const document = await documents.open(spaceId);
				await document.change(() => {
					recordClone(document, { projectId, deviceId, deviceName: deviceId });
				});
			},
		},
		async dropSpace(spaceId) {
			await db.delete(organization).where(eq(organization.id, spaceId));
		},
		async read(spaceId) {
			const document = await documents.open(spaceId);
			const projects: Record<string, string> = {};
			for (const [id, value] of document.projects.entries()) {
				projects[id] = (value as { name: string }).name;
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
