import { harnessFacts } from "@nightshift/agents/harness-facts";
import type { Database } from "@nightshift/db";
import { isCustomHarness } from "@nightshift/flows";
import { NIGHT_SHIFT } from "./contract";
import type { RunBus, RunHistory, RunLog } from "./log";
import type { Peers } from "./peers";
import { type Access, wireViews } from "./runs";

/**
 * The views block of the engine's composition (`wire.ts`): what people
 * see of the runs (`runs/views/`). Lane R2 of the hexagon series owns
 * this file.
 *
 * It gives `reads`, `forSpace`, `cases` and `runs`. The other blocks
 * read `listRuns` (start, cleanup) and `runStatus` (schedules, cleanup)
 * of `reads`. The Space view takes `forSpace`: the use cases, and
 * `reads` for its Gates. The engine calls `readRunHere` and
 * `readRunTrace` of `cases`. `runs` holds the reads of `Engine.runs`:
 * each opens the run for the actor and finds its Space.
 */
export function wireEngineViews(deps: {
	db: Database;
	log: RunLog;
	bus: RunBus;
	device: { id: string };
	peers: Pick<Peers, "pathsFor" | "runs">;
	history: Pick<RunHistory, "ownTranscript">;
	access: Pick<Access, "openRun" | "openSpace">;
	/** The engine's lifetime: a read or a watch ends with it. */
	signal: AbortSignal;
	memberName: (spaceId: string, personId: string) => Promise<string | null>;
}) {
	const { peers, signal } = deps;
	const stands: Omit<Parameters<typeof wireViews>[0], "access"> = {
		db: deps.db,
		log: deps.log,
		bus: deps.bus,
		deviceId: deps.device.id,
		// Any harness, added or not: an old run's session stays takeable.
		// A custom agent has no take-over command.
		harnessOf: (name) =>
			isCustomHarness(name) ? undefined : harnessFacts(name),
		walkers: peers.runs.walkers,
		pendingCommands: peers.runs.pendingCommands,
		stepEntries: peers.runs.stepEntries,
		ownEntries: deps.history.ownTranscript,
		memberName: deps.memberName,
		pathsFor: peers.pathsFor,
	};
	/** Each read opens the run, or the Space, for its actor. */
	const cases = wireViews({ ...stands, access: deps.access });
	/**
	 * The reads of the Space view open the run as Night Shift, as before
	 * this lane: no role is read, and the actor still decides which paths
	 * show. Whole-engine tests read as a Person who is no Member of the
	 * Space (D6 of the run path plan). The API reaches the checked reads
	 * of `Engine.runs` in lane R8.
	 */
	const spaceCases = wireViews({
		...stands,
		access: {
			openRun: (_actor, request) => deps.access.openRun(NIGHT_SHIFT, request),
			openSpace: async () => {},
		},
	});
	/** A disposed engine publishes nothing more: a read or a watch ends with it. */
	const untilDisposed = <T extends { signal: AbortSignal }>(request: T): T => ({
		...request,
		signal: AbortSignal.any([request.signal, signal]),
	});

	return {
		reads: cases.reads,
		cases,
		/** The views group of the Space view (`createSpaces`). */
		forSpace: { reads: cases.reads, views: spaceCases },
		runs: {
			list: cases.listRuns,
			get: cases.readRun,
			step: cases.readStep,
			stepTranscript: (
				actor: Parameters<typeof cases.readStepTranscript>[0],
				request: Parameters<typeof cases.readStepTranscript>[1],
			) => cases.readStepTranscript(actor, untilDisposed(request)),
			watch: (
				actor: Parameters<typeof cases.watchRun>[0],
				request: Parameters<typeof cases.watchRun>[1],
			) => cases.watchRun(actor, untilDisposed(request)),
		},
	};
}
