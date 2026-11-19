import type { Runner } from "./graph";
import type { RunLog } from "./log";
import { parseCalledFlows, parseRunFlow } from "./read";
import {
	createRecovery,
	createSignals,
	wakeLeaseSleeps,
	wakeOfflineSleeps,
} from "./run";

type RecoveryDeps = Parameters<typeof createRecovery>[0];

/**
 * The recovery block of the engine's composition (`wire.ts`): what Night
 * Shift does to a run on its own. Startup recovery and the resume of the
 * runs it interrupted (`run/recovery.ts`), the wakes (`run/wake.ts`), the
 * Signal of a webhook (`run/signals.ts`) and the stop of a run whose
 * Offer ended. Lane R7 of the hexagon series owns this file.
 *
 * It gives every name it returns. The start order of `wire.ts` calls
 * `recoverInterruptedWork` and `armResumes`. The schedules read `signals`.
 * The leases and the engine call the two wakes. The peers call
 * `stopForNightShift`.
 */
export function wireEngineRecovery(
	deps: Omit<RecoveryDeps, "log" | "runner" | "flowOf" | "calledFlowsOf"> & {
		log: RunLog;
		runner: Runner;
	},
) {
	const { db, log, runner } = deps;

	const recovery = createRecovery({
		db,
		log,
		bus: deps.bus,
		runner,
		now: deps.now,
		settings: deps.settings,
		schedulerOn: deps.schedulerOn,
		flowOf: parseRunFlow,
		calledFlowsOf: parseCalledFlows,
		placedElsewhere: deps.placedElsewhere,
		resumeGraceMs: deps.resumeGraceMs,
		signal: deps.signal,
		holds: deps.holds,
		runHolds: deps.runHolds,
	});

	/** A webhook schedule's signal: the project's runs this computer walks that wait for it. */
	const signals = createSignals({ db, log, runner });

	return {
		/** Startup recovery: what the last daemon left open ends, and what continues is noted. */
		recoverInterruptedWork: () => recovery.recoverInterruptedWork(),
		/** The grace of the interrupted runs counts from this call: the engine is ready. */
		armResumes: () => recovery.armResumes(),
		signals,
		/** The runs here that wait for a lease ask again. It does not wait, and it never throws. */
		wakeLeaseSleeps(): void {
			void wakeLeaseSleeps({ db, log, runner }).catch(() => {});
		},
		/** A Device is back: the steps here that sleep because it was offline look again. */
		wakeOfflineSleeps: () => wakeOfflineSleeps({ db, log, runner }),
		/** The Offer the run's step ran under ended: Night Shift stops it, not a person. */
		async stopForNightShift(runId: string): Promise<void> {
			await runner.take(runId, { kind: "stop", by: "daemon" });
		},
	};
}
