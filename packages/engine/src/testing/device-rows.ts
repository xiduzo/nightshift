import type { Database } from "@nightshift/db";
import { runPlaceOf } from "../log/history/history";
import { projectSpaceOf } from "../projects/keep/adapters/out/drizzle-project-rows";
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
		spaceOf: (projectId: string) => projectSpaceOf(db, projectId),
		runPlace: (runId: string) => runPlaceOf(db, runId),
	};
}
