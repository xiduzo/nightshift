import type { Runner } from "./graph";
import type { RunBus, RunLog } from "./log";
import type { Peers } from "./peers";
import { wireWalk } from "./runs";

/**
 * The walk block of the engine's composition (`wire.ts`): a run's facts,
 * its Turns, the Walkers of the runs walked elsewhere, and the start holds
 * (`runs/walk/`). Lane R1 of the hexagon series owns this file.
 *
 * It gives `holds` (recovery, start, actions, the Space move), and the
 * ports `facts`, `turns` and `walkers` for the use cases of lanes R4, R5
 * and R7.
 */
export function wireEngineWalk(deps: {
	log: RunLog;
	bus: RunBus;
	runner: Runner;
	peers: Pick<Peers, "relay" | "runs">;
}) {
	const { relay, runs } = deps.peers;
	return wireWalk({
		facts: { log: deps.log, bus: deps.bus },
		runner: deps.runner,
		walkers: {
			...(relay ? { relay } : {}),
			pendingCommands: runs.pendingCommands,
		},
	});
}
