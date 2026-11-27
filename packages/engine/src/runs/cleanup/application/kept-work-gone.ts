import { keptWorkGone as gone, KEPT_WORK_GONE } from "../domain/kept-work";
import type { RemovalLog } from "./ports";

export type KeptWorkGonePorts = {
	removalLog: Pick<RemovalLog, "removals">;
};

/** The run whose kept work is asked for, and its project. */
export type KeptWorkOf = { id: string; projectId: string };

/**
 * What the person reads when the cleanup of this computer freed the work
 * it kept of the run (`keptWorkGone`), or null while the run has it.
 * The removals of this computer tell: they are no fact of the run.
 */
export const keptWorkGone =
	(ports: KeptWorkGonePorts) =>
	async (run: KeptWorkOf): Promise<string | null> => {
		const removals = await ports.removalLog.removals(run.projectId);
		const ofRun = removals.filter((removal) => removal.runId === run.id);
		return gone(ofRun) ? KEPT_WORK_GONE : null;
	};
