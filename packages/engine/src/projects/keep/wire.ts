import type { Database } from "@nightshift/db";
import type { SpaceDocuments } from "../../documents";
import { drizzleProjectStore } from "./adapters/out/drizzle-project-store";
import { yjsSpaceProjects } from "./adapters/out/yjs-space-projects";
import type {
	ProjectStore,
	SpaceProjects,
	ThisDevice,
} from "./application/ports";

/**
 * The wiring of the ports the requests of the Projects share: the one
 * place that builds their real adapters (the rows over drizzle, the Space
 * documents over Yjs). `catalog` and `clones` take them.
 */

/** What the engine gives the shared ports: what their real adapters stand on. */
export type KeepDeps = {
	db: Database;
	documents: Pick<SpaceDocuments, "open" | "openAll">;
	thisDevice: ThisDevice;
};

/** The shared ports of the Projects. */
export type Keep = {
	store: ProjectStore;
	spaceProjects: SpaceProjects;
};

export function wireKeep(deps: KeepDeps): Keep {
	return {
		store: drizzleProjectStore({
			db: deps.db,
			deviceId: () => deps.thisDevice.deviceId(),
		}),
		spaceProjects: yjsSpaceProjects(deps.documents),
	};
}
