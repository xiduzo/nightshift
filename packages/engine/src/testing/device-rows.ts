import type { Database } from "@nightshift/db";
import { project } from "@nightshift/db/schema";
import { eq } from "drizzle-orm";
import { runPlaceOf } from "../log/history/history";
import { drizzleProjectStore } from "../projects/keep/adapters/out/drizzle-project-store";
import { deviceRowsOf } from "../wire-peers";

/**
 * The engine's rows of a Device on this database, as `PeerContext.deviceRows`
 * gives them: for a test that has a database and no engine.
 */
export function deviceRowsOn(db: Database) {
	const store = drizzleProjectStore({
		db,
		deviceId: async () => {
			throw new Error("The Device rows read no Device of this computer.");
		},
	});
	return deviceRowsOf(db, () => ({
		forget: store.forgetClones,
		adopt: store.adoptClones,
	}));
}

/**
 * Where the engine has a Project and a run on this database, as the peers
 * read them (`PeerProjects.spaceOf`, `RunHistory.runPlace`).
 */
export function placesOn(db: Database) {
	return {
		async spaceOf(projectId: string) {
			const [kept] = await db
				.select({ spaceId: project.spaceId })
				.from(project)
				.where(eq(project.id, projectId));
			return kept?.spaceId ?? null;
		},
		runPlace: (runId: string) => runPlaceOf(db, runId),
	};
}
