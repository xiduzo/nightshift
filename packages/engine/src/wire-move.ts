import type { Database } from "@nightshift/db";
import type { Access } from "./access";
import type { RunWalks } from "./graph";
import type { Peers } from "./peers";
import { type Move, type Walk, wireMove } from "./runs";

/**
 * The move block of the engine's composition (`wire.ts`): the move of a
 * run's walk to another of the Person's Devices, the Devices it can move
 * to, and the other end of a move (`runs/move/`). Lane R5 of the hexagon
 * series owns this file.
 *
 * It gives `arrive`: the peers call it when a run another Device moved
 * here lands (`PeerRuns.takeOver`). `moveRun`: the move as the actions
 * take it (`wire-actions.ts`). `moveTargets`: what the Space view lists.
 * And `runs`: the run use cases of
 * `Engine.runs` this block holds (`move`, `moveTargets`).
 */
export function wireEngineMove(deps: {
	access: Pick<Access, "openRun">;
	walk: Pick<Walk, "facts" | "turns" | "walkers">;
	db: Database;
	/**
	 * The other Devices and Hosts: their archive keeps the walk of a run
	 * that moves (`runs`), and their planner says where the walk may move
	 * (`placement`: one of the Person's own Devices, online).
	 */
	peers: {
		runs: Pick<Peers["runs"], "keepWalk" | "archived">;
		placement: Pick<Peers["placement"], "moveTo" | "devicesFor" | "deviceById">;
	};
	walks: Pick<RunWalks, "exportWalk" | "importWalk" | "importTranscript">;
	/** This computer as a Device. */
	device: { id: string };
}) {
	// Each use case opens the run for its actor and checks the actor's role.
	const move: Move = wireMove({
		access: deps.access,
		walk: deps.walk,
		devices: deps.peers.placement,
		handover: {
			db: deps.db,
			walkerId: () => deps.walk.facts.walkerId(),
			archive: deps.peers.runs,
			walks: deps.walks,
		},
		device: deps.device,
	});

	return {
		/** This computer walks a run that another Device moved here. */
		arrive: move.arriveRun,
		/** The move, as the actions take it (`wire-actions.ts`). */
		moveRun: move.moveRun,
		/** The Devices a run can move to, as the Space view lists them. */
		moveTargets: move.listMoveTargets,
		runs: {
			move: move.moveRun,
			moveTargets: move.listMoveTargets,
		},
	};
}
