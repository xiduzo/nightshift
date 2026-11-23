import type { Actor } from "../../../contract";
import type { RunFile } from "../domain/run-files";
import type { CleanupAccess, RunFolderFiles } from "./ports";

export type ReadRunFilePorts = {
	access: CleanupAccess;
	folders: Pick<RunFolderFiles, "file">;
};

/** Which file of which run, in which Space when the caller holds one. */
export type ReadRunFile = { runId: string; spaceId?: string; path: string };

/**
 * One file of the run's folder on this computer, and where it is. Null
 * when there is none at that path. Refuses a path that is not one of a
 * file of the run. A run the actor may not see is not found
 * (`access.openRun`), before anything else.
 */
export const readRunFile =
	(ports: ReadRunFilePorts) =>
	async (
		actor: Actor,
		request: ReadRunFile,
	): Promise<{ file: RunFile; path: string } | null> => {
		const { runId, spaceId } = request;
		await ports.access.openRun(actor, { runId, spaceId });
		return ports.folders.file(runId, request.path);
	};
