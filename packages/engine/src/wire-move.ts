import type { Database } from "@nightshift/db";
import { NIGHT_SHIFT } from "./contract";
import type { RunWalks } from "./graph";
import type { Peers } from "./peers";
import { type Access, type Move, type Walk, wireMove } from "./runs";

/**
 * The move block of the engine's composition (`wire.ts`): the move of a
 * run's walk to another of the Person's Devices, the Devices it can move
 * to, and the other end of a move (`runs/move/`). Lane R5 of the hexagon
 * series owns this file.
 *
 * It gives `arrive`: the peers call it when a run another Device moved
 * here lands (`PeerRuns.takeOver`). `moveRunWith`: the move as the actions
 * take it (`wire-actions.ts`), over the way they open a run. `moveTargets`:
 * what the Space view lists. And `runs`: the run use cases of
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
	/** The move's use cases, over one way to open a run. */
	function bind(openRun: Access["openRun"]): Move {
		return wireMove({
			access: { openRun },
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
	}

	// `Engine.runs`: each use case checks the actor's role itself.
	const checked = bind(deps.access.openRun);
	// The Space view: each door checks the Person's role before it asks
	// (the API, the Host, the Walker). Until lane R8 moves that check into
	// the use cases, the view opens the run as before: in its Space, as
	// Night Shift, with no role read. So no door answers differently.
	const view = bind((_actor, { runId, spaceId }) =>
		deps.access.openRun(NIGHT_SHIFT, { runId, spaceId }),
	);

	return {
		/** This computer walks a run that another Device moved here. */
		arrive: checked.arriveRun,
		/** The move, over the way the actions open a run (`wire-actions.ts`). */
		moveRunWith: (openRun: Access["openRun"]) => bind(openRun).moveRun,
		/** The Devices a run can move to, as the Space view lists them. */
		moveTargets: view.listMoveTargets,
		runs: {
			move: checked.moveRun,
			moveTargets: checked.listMoveTargets,
		},
	};
}
