import type { Peers } from "./peers";
import { takeOver } from "./run";

type TakeOverDeps = Parameters<typeof takeOver>[0];

/**
 * The move block of the engine's composition (`wire.ts`): the other end
 * of a move (`run/take-over.ts`). The move itself is still an action
 * (`wire-actions.ts`). Lane R5 of the hexagon series owns this file.
 *
 * It gives `arrive`. The peers call it when a run another Device moved
 * here lands (`PeerRuns.takeOver`).
 */
export function wireEngineMove(
	deps: Pick<TakeOverDeps, "db" | "log" | "runner" | "walks"> & {
		/** The other Devices and Hosts. Their archive keeps the walk of a run that moves. */
		peers: Pick<Peers, "runs">;
	},
) {
	return {
		/** This computer walks a run that another Device moved here. */
		arrive: (runId: string) =>
			takeOver(
				{
					db: deps.db,
					log: deps.log,
					runner: deps.runner,
					archive: deps.peers.runs,
					walks: deps.walks,
				},
				runId,
			),
	};
}
