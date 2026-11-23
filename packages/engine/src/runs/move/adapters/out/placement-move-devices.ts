import { UNADVERTISED_FLOW_VERSION } from "../../../../graph";
import { placedRun } from "../../../../log";
import type { PlacementPort } from "../../../../placement";
import type { MoveDevices } from "../../application/ports";

/** The planner of the run's Space (`PlacementPort` of the peers), as much of it as a move asks. */
export type PlacementMoveDevicesDeps = Pick<
	PlacementPort,
	"moveTo" | "deviceById" | "devicesFor"
>;

/**
 * The Person's Devices over the planner of the peers: `devices` in a
 * daemon (its registry, its Links and its Offers), the fake of a computer
 * alone in the engine's tests. The planner decides which Devices are the
 * Person's own and refuses one that is offline. A Device that does not say
 * which flow format it reads reads format 8 (`UNADVERTISED_FLOW_VERSION`).
 */
export function placementMoveDevices(
	placement: PlacementMoveDevicesDeps,
): MoveDevices {
	return {
		target: (run, person, deviceId) =>
			placement.moveTo(placedRun(run), person, deviceId),
		async capabilities(target, run) {
			const has = await placement
				.deviceById(target.id, placedRun(run), target.name)
				.capabilities();
			return {
				flowVersion: has.flowVersion ?? UNADVERTISED_FLOW_VERSION,
				testRuns: has.testRuns === true,
			};
		},
		own: (run, person) =>
			placement.devicesFor(run.spaceId, person.personId, run.projectId),
	};
}
