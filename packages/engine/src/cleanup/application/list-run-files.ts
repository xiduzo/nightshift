import type { Actor } from "../../contract";
import { knownRun, NO_FILES, type RunFiles } from "../domain/run-files";
import { cleanupTime } from "../domain/safety";
import type {
	CleanupAccess,
	CleanupGround,
	CleanupRuns,
	RemovalLog,
	RunFolderFiles,
} from "./ports";

export type ListRunFilesPorts = {
	access: CleanupAccess;
	runs: Pick<CleanupRuns, "runRow" | "runState" | "isActive">;
	folders: Pick<RunFolderFiles, "list">;
	removalLog: Pick<RemovalLog, "removals">;
	ground: Pick<CleanupGround, "settings">;
};

/** Which run, in which Space when the caller holds one. */
export type ListRunFiles = { runId: string; spaceId?: string };

/**
 * The files of a run in its run folder on this computer, and when the
 * scheduled cleanup removes them. Empty for a run that works in a copy of
 * the project. A folder that went says when, and who removed it. A run
 * the actor may not see is not found (`access.openRun`), before anything
 * else.
 */
export const listRunFiles =
	(ports: ListRunFilesPorts) =>
	async (actor: Actor, request: ListRunFiles): Promise<RunFiles> => {
		const { runId, spaceId } = request;
		await ports.access.openRun(actor, { runId, spaceId });
		const run = await knownRun(runId, ports.runs);
		if (!run?.runFolder) return NO_FILES;
		const listed = await ports.folders.list(runId);
		if (!listed) {
			const removals = await ports.removalLog.removals(run.projectId);
			const last = removals.findLast((removal) => removal.runId === run.id);
			return {
				...NO_FILES,
				removed: last ? { at: last.at, by: last.by } : null,
			};
		}
		const { cleanUpRuns, cleanUpAfterDays } = ports.ground.settings();
		return {
			here: true,
			files: listed.files,
			more: listed.more,
			cleanupAt:
				cleanUpRuns && !run.open ? cleanupTime(run, cleanUpAfterDays) : null,
			removed: null,
		};
	};
