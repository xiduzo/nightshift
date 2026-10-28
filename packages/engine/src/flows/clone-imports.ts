import type { Database } from "@nightshift/db";
import { clone, project } from "@nightshift/db/schema";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { ProfileStore } from "../device-config";
import type { Git } from "../projects";
import type { FlowDocuments } from "./flow-document";
import type { FlowMigrations } from "./flow-migration";
import { importClone } from "./import";
import { trackedState } from "./legacy-folder";

/**
 * When the import on upgrade (`import.ts`) runs: for every Clone on this
 * Device when the engine starts, and for a Clone a person adds. Each Clone
 * is imported once; an import that fails is logged and tried again at the
 * next start. A run of one Clone never overlaps another of it.
 */
export type CloneImports = {
	/** Imports every Clone of this Device whose import is not done. Never throws. */
	all(): Promise<void>;
	/** Imports this Device's Clone of the project, when its import is not done. Never throws. */
	project(projectId: string): Promise<void>;
};

export function createCloneImports(deps: {
	db: Database;
	documents: Pick<FlowDocuments, "open" | "flush">;
	git: Pick<Git, "run">;
	/** This Device: the owner of its Clones, and the name a notice gives it. */
	device(): Promise<{ id: string; name: string }>;
	profiles?: Pick<ProfileStore, "list" | "save"> | undefined;
	/** What brings the folder's flows to the current format on this Device. */
	migrations?: FlowMigrations;
	now(): number;
}): CloneImports {
	const running = new Map<string, Promise<void>>();

	async function clonesHere(projectId?: string) {
		const { id } = await deps.device();
		return deps.db
			.select({
				id: clone.id,
				projectId: clone.projectId,
				repoPath: clone.path,
			})
			.from(clone)
			.innerJoin(project, eq(project.id, clone.projectId))
			.where(
				and(
					eq(clone.deviceId, id),
					isNull(project.removedAt),
					projectId === undefined ? undefined : eq(clone.projectId, projectId),
				),
			)
			.orderBy(asc(clone.createdAt));
	}

	function importOne(row: {
		id: string;
		projectId: string;
		repoPath: string;
	}): Promise<void> {
		const found = running.get(row.id);
		if (found) return found;
		const run = (async () => {
			await importClone({
				document: await deps.documents.open(row.projectId),
				clone: { id: row.id, repoPath: row.repoPath },
				device: await deps.device(),
				tracked: (repoPath, folder) => trackedState(deps.git, repoPath, folder),
				profiles: deps.profiles,
				...(deps.migrations
					? {
							migration: async () =>
								(deps.migrations as FlowMigrations).forDevice(
									(await deps.device()).id,
								),
						}
					: {}),
				flush: () => deps.documents.flush(),
				at: deps.now(),
			});
		})()
			.catch((error) => {
				console.warn(
					"Night Shift could not import the flow folder of a project. It tries again at the next start:",
					error,
				);
			})
			.finally(() => running.delete(row.id));
		running.set(row.id, run);
		return run;
	}

	return {
		async all() {
			const rows = await clonesHere().catch((error) => {
				console.warn("Night Shift could not list the project folders:", error);
				return [];
			});
			for (const row of rows) await importOne(row);
		},
		async project(projectId) {
			const rows = await clonesHere(projectId).catch(() => []);
			for (const row of rows) await importOne(row);
		},
	};
}
