import type { Database } from "@nightshift/db";
import { organization, project } from "@nightshift/db/schema";
import { eq } from "drizzle-orm";
import type { ProjectSpaces } from "../../application/ports";

/** The Spaces of the Projects over the database: the `project` and `organization` rows. */
export function drizzleProjectSpaces(db: Database): ProjectSpaces {
	return {
		async spaceOf(projectId) {
			const [row] = await db
				.select({ spaceId: project.spaceId })
				.from(project)
				.where(eq(project.id, projectId));
			return row?.spaceId ?? null;
		},
		async isShared(spaceId) {
			const [row] = await db
				.select({ personal: organization.personal })
				.from(organization)
				.where(eq(organization.id, spaceId));
			return row ? !row.personal : false;
		},
		async projectsIn(spaceId) {
			const rows = await db
				.select({ id: project.id })
				.from(project)
				.where(eq(project.spaceId, spaceId));
			return rows.map(({ id }) => id);
		},
	};
}
