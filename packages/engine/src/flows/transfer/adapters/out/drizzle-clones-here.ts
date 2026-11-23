import type { Database } from "@nightshift/db";
import { clone, project } from "@nightshift/db/schema";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { ClonesHere } from "../../application/ports";

/** The Clone rows of a Device, joined to their Project rows. */
export function drizzleClonesHere(deps: { db: Database }): ClonesHere {
	return {
		list(deviceId, projectId) {
			return deps.db
				.select({
					id: clone.id,
					projectId: clone.projectId,
					spaceId: project.spaceId,
					repoPath: clone.path,
				})
				.from(clone)
				.innerJoin(project, eq(project.id, clone.projectId))
				.where(
					and(
						eq(clone.deviceId, deviceId),
						isNull(project.removedAt),
						projectId === undefined
							? undefined
							: eq(clone.projectId, projectId),
					),
				)
				.orderBy(asc(clone.createdAt));
		},
	};
}
