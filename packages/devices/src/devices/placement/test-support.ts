import type { Database } from "@nightshift/db";
import type {
	PlacementDeps,
	PlacementModule,
} from "./application/create-placement";
import { wirePlacement } from "./wire";

export type LegacyPlacementDeps = Omit<PlacementDeps, "spacePeople"> & {
	db: Database;
};

/** Old factory shape for the placement suite. */
export function createPlacement(deps: LegacyPlacementDeps): PlacementModule {
	return wirePlacement().createPlacement(deps);
}
