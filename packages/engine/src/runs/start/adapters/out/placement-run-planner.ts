import type { Database } from "@nightshift/db";
import { capabilitiesFor, refusalOf } from "../../../../graph";
import { lastRunDevice } from "../../../../log";
import type { PlacementPort } from "../../../../placement";
import type { RunPlanner } from "../../application/ports";

/** What the planner of the start stands on: the Devices a run may use (`Peers.placement`), and the runs of each project. */
export type PlacementRunPlannerDeps = {
	db: Database;
	devices: Pick<PlacementPort, "plan" | "placements" | "devicesFor">;
};

/**
 * Where a run's steps run, over Placement (`PlacementPort` of the peers):
 * its plan with the project's latest run's Device as the first last
 * resort, and the one fit check of Placement (`graph/fit/`).
 */
export function placementRunPlanner(deps: PlacementRunPlannerDeps): RunPlanner {
	const { db, devices } = deps;
	return {
		plan: async (input) =>
			devices.plan({
				...input,
				lastRun: await lastRunDevice(db, input.project.id),
			}),
		misfit: async (nodes, device) =>
			refusalOf(nodes, await capabilitiesFor(nodes, device)),
		placements: (spaceId, personId, projectId) =>
			devices.placements(spaceId, personId, projectId),
		devicesFor: (spaceId, personId, projectId, forNode) =>
			devices.devicesFor(spaceId, personId, projectId, forNode),
		lastRunDevice: (projectId) => lastRunDevice(db, projectId),
	};
}
