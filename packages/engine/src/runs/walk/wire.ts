import type { Runner } from "../../graph";
import {
	type LogRunFactsDeps,
	logRunFacts,
} from "./adapters/out/log-run-facts";
import {
	type RelayWalkersDeps,
	relayWalkers,
} from "./adapters/out/relay-walkers";
import { runnerTurns } from "./adapters/out/runner-turns";
import type { RunFacts, Turns, Walkers } from "./application/ports";
import { createStartHolds, type StartHolds } from "./domain/start-holds";

/**
 * The wiring of the walk: the one place that builds its real adapters
 * (the run's facts over the run log and the run bus, the Turns over the
 * runner, the Walkers over a Host's relay) and its long-lived domain
 * object, the start holds. The use cases that write to a run take them.
 */

/** What the engine gives the walk: what its real adapters stand on. */
export type WalkDeps = {
	facts: LogRunFactsDeps;
	runner: Runner;
	walkers: RelayWalkersDeps;
};

/** The ports every use case that writes to a run shares, and the start holds. */
export type Walk = {
	/** The Spaces whose runs do not become active while their Projects move. */
	holds: StartHolds;
	facts: RunFacts;
	turns: Turns;
	walkers: Walkers;
};

export function wireWalk(deps: WalkDeps): Walk {
	return {
		holds: createStartHolds(),
		facts: logRunFacts(deps.facts),
		turns: runnerTurns(deps.runner),
		walkers: relayWalkers(deps.walkers),
	};
}
