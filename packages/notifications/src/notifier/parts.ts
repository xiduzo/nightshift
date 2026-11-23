import { now as timeNow } from "@nightshift/time";
import { createGateTracker, type GateTracker } from "./domain/gate-tracker";
import { createBundles, createPruneClock } from "./domain/notifier-state";
import { createWaitTracker, type WaitTracker } from "./domain/wait-tracker";
import type { NotifierDeps } from "./types";

/**
 * What each piece of the notifier's work reads and sends through: its
 * deps, and the state it keeps from one piece of work to the next.
 */
export type NotifierParts = {
	deps: NotifierDeps;
	now: () => number;
	onError: (message: string, error: unknown) => void;
	/** The open Gates this notifier knows, and what the engine said of each. */
	gates: GateTracker;
	/** The steps that wait for an offline Device. */
	waits: WaitTracker;
	mayAnswer: (spaceId: string, personId: string) => Promise<boolean>;
	bundles: ReturnType<typeof createBundles>;
	pruning: ReturnType<typeof createPruneClock>;
};

/** The parts of one notifier, with the defaults of its deps. */
export function notifierParts(deps: NotifierDeps): NotifierParts {
	return {
		deps,
		now: deps.now ?? timeNow,
		onError:
			deps.onError ??
			((message: string, error: unknown) =>
				console.error(`[notifications] ${message}`, error)),
		gates: createGateTracker((spaceId) => deps.events.openGates(spaceId)),
		waits: createWaitTracker(),
		mayAnswer: deps.mayAnswer ?? (async () => false),
		bundles: createBundles(),
		pruning: createPruneClock(),
	};
}
