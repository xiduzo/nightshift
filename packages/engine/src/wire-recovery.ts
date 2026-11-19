import { parseCalledFlows, parseRunFlow } from "./read";
import { wireRecovery } from "./runs";

type RecoveryDeps = Parameters<typeof wireRecovery>[0];

/**
 * The recovery block of the engine's composition (`wire.ts`): what Night
 * Shift does to a run on its own (`runs/recovery`). Startup recovery and
 * the resume of the runs it interrupted, the wakes, the Signal of a
 * webhook and the stop of a run whose Offer ended. Lane R7 of the hexagon
 * series owns this file.
 *
 * It gives every name it returns. The start order of `wire.ts` calls
 * `recoverInterruptedWork` and `armResumes`. The schedules read `signals`.
 * The leases and the engine call the two wakes. The peers call
 * `stopForNightShift`.
 */
export function wireEngineRecovery(
	deps: Omit<
		RecoveryDeps,
		"openWork" | "waits" | "facts" | "turns" | "holds" | "openRun"
	> &
		Omit<RecoveryDeps["openWork"], "flowOf" | "calledFlowsOf"> & {
			/** The walk block: the run's facts, its Turns and the start holds. */
			walk: Pick<RecoveryDeps, "facts" | "turns" | "holds">;
			/** The access block: the run, opened as Night Shift. */
			access: Pick<RecoveryDeps, "openRun">;
		},
) {
	const { db, log, walk } = deps;
	const recovery = wireRecovery({
		...deps,
		facts: walk.facts,
		turns: walk.turns,
		holds: walk.holds,
		openRun: deps.access.openRun,
		openWork: {
			db,
			log,
			bus: deps.bus,
			flowOf: parseRunFlow,
			calledFlowsOf: parseCalledFlows,
			runHolds: deps.runHolds,
		},
		waits: { db, log },
	});

	return {
		/** Startup recovery: what the last daemon left open ends, and what continues is noted. */
		recoverInterruptedWork: () => recovery.recoverRuns(),
		/** The grace of the interrupted runs counts from this call: the engine is ready. */
		armResumes: () => recovery.armResumes(),
		/** A webhook schedule's signal: the project's runs this computer walks that wait for it. */
		signals: { send: recovery.signalProjectRuns },
		/** The runs here that wait for a lease ask again. It does not wait, and it never throws. */
		wakeLeaseSleeps(): void {
			void recovery.wakeSleepingRuns("lease").catch(() => {});
		},
		/** A Device is back: the steps here that sleep because it was offline look again. */
		wakeOfflineSleeps: () => recovery.wakeSleepingRuns("device-offline"),
		/** The Offer the run's step ran under ended: Night Shift stops it, not a person. */
		stopForNightShift: (runId: string) => recovery.stopRunForNightShift(runId),
	};
}
