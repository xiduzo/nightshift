import type { Database } from "@nightshift/db";
import { clone, project, run } from "@nightshift/db/schema";
import { instant, instantOrNull } from "@nightshift/time";
import { and, eq, exists, inArray, or } from "drizzle-orm";
import type { MovingProject } from "../../domain/project";

/**
 * The reads of the Projects a merge or a split of Spaces makes, for
 * `drizzleProjectStore`: they move as they were.
 */

const movingColumns = {
	id: project.id,
	spaceId: project.spaceId,
	name: project.name,
	remote: project.remote,
	folder: project.folder,
	createdAt: project.createdAt,
	removedAt: project.removedAt,
};

function moving(row: {
	id: string;
	spaceId: string;
	name: string;
	remote: string | null;
	folder: boolean;
	createdAt: Date;
	removedAt: Date | null;
}): MovingProject {
	return {
		...row,
		createdAt: instant(row.createdAt),
		removedAt: instantOrNull(row.removedAt),
	};
}

/**
 * The Projects of this Replica with one of `ids` or one of `remotes`, in
 * any Space, removed ones too: what a Host reads before it takes the
 * Projects of a Device's personal Space (one Project per remote on a
 * Replica, `project_remote_idx`).
 */
export async function projectRowsOf(
	db: Database,
	input: { ids?: readonly string[]; remotes?: readonly string[] },
): Promise<MovingProject[]> {
	const ids = [...(input.ids ?? [])];
	const remotes = [...(input.remotes ?? [])];
	if (ids.length === 0 && remotes.length === 0) return [];
	const rows = await db
		.select(movingColumns)
		.from(project)
		.where(
			or(
				ids.length > 0 ? inArray(project.id, ids) : undefined,
				remotes.length > 0 ? inArray(project.remote, remotes) : undefined,
			),
		);
	return rows.map(moving);
}

/**
 * The Projects of a Space, removed ones too, oldest first, whether
 * `deviceId` has a Clone of each, and whether it walked a run of it in
 * the Space: what a Device asks its home Host to take when its own
 * personal Space merges into the Host's, and what a split takes along.
 */
export async function spaceProjectRows(
	db: Database,
	spaceId: string,
	deviceId: string,
): Promise<(MovingProject & { clone: boolean; walked: boolean })[]> {
	const walked = exists(
		db
			.select({ id: run.id })
			.from(run)
			.where(
				and(
					eq(run.projectId, project.id),
					eq(run.spaceId, spaceId),
					eq(run.walkerId, deviceId),
				),
			),
	);
	const rows = await db
		.select({ ...movingColumns, cloneId: clone.id, walked })
		.from(project)
		.leftJoin(
			clone,
			and(eq(clone.projectId, project.id), eq(clone.deviceId, deviceId)),
		)
		.where(eq(project.spaceId, spaceId))
		.orderBy(project.createdAt, project.id);
	return rows.map(({ cloneId, walked, ...row }) => ({
		...moving(row),
		clone: cloneId !== null,
		walked: Boolean(walked),
	}));
}

/** The Space of a Project, a removed one too. Null for one this Replica lacks. */
export async function projectSpaceOf(
	db: Database,
	projectId: string,
): Promise<string | null> {
	const [kept] = await db
		.select({ spaceId: project.spaceId })
		.from(project)
		.where(eq(project.id, projectId));
	return kept?.spaceId ?? null;
}
