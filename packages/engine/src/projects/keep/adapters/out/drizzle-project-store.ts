import { randomUUID } from "node:crypto";
import type { Database } from "@nightshift/db";
import { clone, project } from "@nightshift/db/schema";
import { and, asc, eq, getColumns, isNull, type SQL } from "drizzle-orm";
import type { RowBatch } from "../../../../contract";
import type { ProjectStore } from "../../application/ports";
import type { ProjectRecord, ProjectsHere } from "../../domain/project";
import { projectRowsOf, spaceProjectRows } from "./drizzle-project-rows";

/**
 * The folder of a project's Clone on this computer (the Replica's own
 * Device, `selfId`), or null: what `localDevice` works in. With a Space, a
 * project of another Space has none. Null too when this computer has no
 * Device yet.
 */
export function clonePathOf(
	db: Database,
	selfId: () => Promise<string | null>,
): (projectId: string, spaceId?: string) => Promise<string | null> {
	return async (projectId, spaceId) => {
		const deviceId = await selfId();
		if (deviceId === null) return null;
		const [row] = await db
			.select({ path: clone.path })
			.from(clone)
			.innerJoin(project, eq(project.id, clone.projectId))
			.where(
				and(
					eq(clone.projectId, projectId),
					eq(clone.deviceId, deviceId),
					isNull(project.removedAt),
					spaceId === undefined ? undefined : eq(project.spaceId, spaceId),
				),
			);
		return row?.path ?? null;
	};
}

/**
 * Whether a project has no folder (ADR 22): no Device has a Clone of it,
 * so what works for it here works in a folder of its own. False for a
 * project this Replica does not know, or that a person removed.
 */
export function withoutFolderOf(
	db: Database,
): (projectId: string) => Promise<boolean> {
	return async (projectId) => {
		const [row] = await db
			.select({ folder: project.folder })
			.from(project)
			.where(and(eq(project.id, projectId), isNull(project.removedAt)));
		return row?.folder === false;
	};
}

/** Only the Space's projects; every Space's without one (background work). */
const inSpace = (spaceId: string | undefined) =>
	spaceId === undefined ? undefined : eq(project.spaceId, spaceId);

/** The condition of `ProjectStore.here`: every part given must hold. */
function hereWhere(filter: ProjectsHere): SQL | undefined {
	const parts: SQL[] = [];
	if (filter.path !== undefined) parts.push(eq(clone.path, filter.path));
	if (filter.projectId !== undefined) {
		parts.push(eq(project.id, filter.projectId));
	}
	if (filter.kept) parts.push(isNull(project.removedAt));
	if (filter.spaceId !== undefined) {
		parts.push(eq(project.spaceId, filter.spaceId));
	}
	if (filter.withoutRemote) parts.push(isNull(project.remote));
	return parts.length === 1 ? parts[0] : and(...parts);
}

/** The statements leave as the opaque batch the ports name (G2). */
const batchOf = (...statements: unknown[]) => statements as unknown as RowBatch;

/**
 * `ProjectStore` over drizzle: the `project` and `clone` rows. `deviceId`
 * is this computer's Device: the Clone "here" is its Clone.
 */
export function drizzleProjectStore(deps: {
	db: Database;
	deviceId(): Promise<string>;
}): ProjectStore {
	const { db } = deps;

	/** Projects with a Clone on this computer, with its path, removed ones too. */
	async function withClone(where: SQL | undefined) {
		const deviceId = await deps.deviceId();
		return db
			.select({ ...getColumns(project), repoPath: clone.path })
			.from(project)
			.innerJoin(
				clone,
				and(eq(clone.projectId, project.id), eq(clone.deviceId, deviceId)),
			)
			.where(where)
			.orderBy(asc(project.createdAt));
	}

	return {
		async row(projectId) {
			const [row] = await db
				.select()
				.from(project)
				.where(eq(project.id, projectId));
			return (row satisfies ProjectRecord | undefined) ?? null;
		},

		async find(projectId, spaceId) {
			const deviceId = await deps.deviceId();
			const [row] = await db
				.select({ ...getColumns(project), repoPath: clone.path })
				.from(project)
				.leftJoin(
					clone,
					and(eq(clone.projectId, project.id), eq(clone.deviceId, deviceId)),
				)
				.where(
					and(
						eq(project.id, projectId),
						isNull(project.removedAt),
						inSpace(spaceId),
					),
				);
			return row ?? null;
		},

		async listInSpace(spaceId) {
			const deviceId = await deps.deviceId();
			return db
				.select({ ...getColumns(project), repoPath: clone.path })
				.from(project)
				.leftJoin(
					clone,
					and(eq(clone.projectId, project.id), eq(clone.deviceId, deviceId)),
				)
				.where(and(isNull(project.removedAt), inSpace(spaceId)))
				.orderBy(asc(project.createdAt));
		},

		here: (filter) => withClone(hereWhere(filter)),

		async byRemote(remote) {
			const [found] = await db
				.select()
				.from(project)
				.where(eq(project.remote, remote));
			return found ?? null;
		},

		clonePath: (projectId, spaceId) =>
			clonePathOf(db, deps.deviceId)(projectId, spaceId),

		withoutFolder: (projectId) => withoutFolderOf(db)(projectId),

		ofSpace: async (spaceId) =>
			spaceProjectRows(db, spaceId, await deps.deviceId()),

		matching: (input) => projectRowsOf(db, input),

		async keepHosted(row) {
			await db
				.insert(project)
				.values(row)
				.onConflictDoUpdate({
					target: project.id,
					set: { removedAt: null },
					where: eq(project.spaceId, row.spaceId),
				});
		},

		async keepHostedWithoutFolder(row) {
			await db
				.insert(project)
				.values({ ...row, remote: null, folder: false })
				.onConflictDoNothing();
		},

		async addClone(row) {
			await db.insert(clone).values({ id: randomUUID(), ...row });
		},

		cloneRow: ({ moved, ...row }) =>
			batchOf(
				moved
					? db
							.update(clone)
							.set({ path: row.path })
							.where(
								and(
									eq(clone.projectId, row.projectId),
									eq(clone.deviceId, row.deviceId),
								),
							)
					: db.insert(clone).values({ id: randomUUID(), ...row }),
			),

		forgetClones: (deviceId) =>
			batchOf(db.delete(clone).where(eq(clone.deviceId, deviceId))),

		adoptClones: (from, to) =>
			batchOf(
				db.update(clone).set({ deviceId: to }).where(eq(clone.deviceId, from)),
			),
	};
}
