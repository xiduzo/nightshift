import { harnessFacts } from "@nightshift/agents/harness-facts";
import { isCustomHarness } from "@nightshift/flows";
import { createReadModel } from "./read";

type ReadModelDeps = Parameters<typeof createReadModel>[0];

/**
 * The views block of the engine's composition (`wire.ts`): the read model
 * of the runs (`read/read-model.ts`). Lane R2 of the hexagon series owns
 * this file.
 *
 * It gives `reads`. The other blocks read `listRuns` (start),
 * `runStatus` (schedules, cleanup), `runHere` and `trace` (the engine),
 * and the Space view takes all of it.
 */
export function wireEngineViews(
	deps: Pick<
		ReadModelDeps,
		| "db"
		| "log"
		| "bus"
		| "deviceId"
		| "walkers"
		| "pendingCommands"
		| "stepEntries"
		| "ownEntries"
		| "memberName"
	>,
) {
	const reads = createReadModel({
		db: deps.db,
		log: deps.log,
		bus: deps.bus,
		deviceId: deps.deviceId,
		// Any harness, added or not: an old run's session stays takeable.
		// A custom agent has no take-over command.
		harnessOf: (name) =>
			isCustomHarness(name) ? undefined : harnessFacts(name),
		walkers: deps.walkers,
		pendingCommands: deps.pendingCommands,
		stepEntries: deps.stepEntries,
		ownEntries: deps.ownEntries,
		memberName: deps.memberName,
	});

	return { reads };
}
