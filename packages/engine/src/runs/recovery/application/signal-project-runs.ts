import { RunRefusal } from "../../../run-status";
import type { RunFacts, Turns } from "../../walk";
import {
	type ProjectSignal,
	refuseUnlessWaiting,
	takes,
} from "../domain/signal-match";
import type { Waits } from "./ports";

export type SignalProjectRunsPorts = {
	waits: Pick<Waits, "waitedFor">;
	facts: Pick<RunFacts, "state">;
	turns: Pick<Turns, "take">;
};

/**
 * A webhook schedule's signal: it wakes every run of the project that
 * waits for it and takes it (`takes`), each in a Turn of its own. A full
 * run cap queues the wake. Only the runs this computer walks wake: a run
 * another Device walks waits for a signal sent there, or by its id.
 * Returns how many runs it woke or queued.
 */
export const signalProjectRuns =
	(ports: SignalProjectRunsPorts) =>
	async (projectId: string, signal: ProjectSignal): Promise<number> => {
		let woke = 0;
		for (const runId of await ports.waits.waitedFor(projectId, signal.name)) {
			if (!(await takes((await ports.facts.state(runId)).sleep, signal))) {
				continue;
			}
			try {
				await ports.turns.take(
					runId,
					{
						kind: "wake",
						early: true,
						signal: signal.name,
						data: signal.data,
					},
					// It may have moved on since: a stop, a person's signal.
					{ whenFull: "queue", check: refuseUnlessWaiting(signal) },
				);
				woke++;
			} catch (error) {
				if (!(error instanceof RunRefusal)) {
					console.error(`[signals] could not wake run ${runId}`, error);
				}
			}
		}
		return woke;
	};
