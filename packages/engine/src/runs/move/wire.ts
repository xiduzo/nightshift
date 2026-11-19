import { olderNightShift } from "../../placement";
import type { Access } from "../access";
import type { Walk } from "../walk";
import {
	type ArchiveWalkHandoverDeps,
	archiveWalkHandover,
} from "./adapters/out/archive-walk-handover";
import {
	type PlacementMoveDevicesDeps,
	placementMoveDevices,
} from "./adapters/out/placement-move-devices";
import { arriveRun } from "./application/arrive-run";
import { listMoveTargets } from "./application/list-move-targets";
import { moveRun } from "./application/move-run";

/**
 * The wiring of the move: the one place that builds its real adapters
 * (the Person's Devices over the planner of the peers, the hand-over of
 * the walk state over the Space archive and this computer's walk files)
 * and binds each use case to its ports. The ports every use case that
 * writes to a run shares come from `runs/walk`, the check of who may act
 * from `runs/access`.
 */

/** What the engine gives the move: the sibling sub-verticals, and what the real adapters stand on. */
export type MoveDeps = {
	access: Pick<Access, "openRun">;
	walk: Pick<Walk, "facts" | "turns" | "walkers">;
	/** The planner of the peers (`PlacementPort`). */
	devices: PlacementMoveDevicesDeps;
	/** The Space archive, this computer's walk files and the run rows. */
	handover: ArchiveWalkHandoverDeps;
	/** This computer as a Device. */
	device: { id: string };
};

/** The use cases of the move, bound to their ports. */
export type Move = {
	/** Moves a run's walk to another of the Person's Devices. */
	moveRun: ReturnType<typeof moveRun>;
	/** The Person's own Devices a run can move to. */
	listMoveTargets: ReturnType<typeof listMoveTargets>;
	/** This computer walks a run that another Device moved here. */
	arriveRun: ReturnType<typeof arriveRun>;
};

export function wireMove(deps: MoveDeps): Move {
	const { openRun } = deps.access;
	const { facts, turns, walkers } = deps.walk;
	const devices = placementMoveDevices(deps.devices);
	const handover = archiveWalkHandover(deps.handover);
	return {
		moveRun: moveRun({
			openRun,
			facts,
			turns,
			walkers,
			devices,
			handover,
			device: deps.device,
			olderNightShift,
		}),
		listMoveTargets: listMoveTargets({ openRun, devices }),
		arriveRun: arriveRun({ facts, turns, handover }),
	};
}
