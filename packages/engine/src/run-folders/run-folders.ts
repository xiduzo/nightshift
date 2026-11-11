import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Refusal } from "@nightshift/refusal";

/**
 * Run folders (ADR 22): the folder a run of a project without a folder
 * works in, on each Device that runs one of its steps. One flat folder per
 * run in the data folder, `<dataDir>/run-folders/<runId>/`, like the
 * artifacts. It starts empty and has no git: what its steps write there
 * are the run's files. It does not move between Devices: each Device has
 * its own folder of the run.
 */

export type RunFolders = ReturnType<typeof createRunFolders>;

/**
 * Why a Device makes no run folder: it runs an older Night Shift, which
 * does not know the call (or a test's Device, which has none).
 */
export function noRunFolders(deviceName: string): string {
	return `Update Night Shift on ${deviceName} to run projects without a folder.`;
}

/** A run id as a folder name: no separator, no `..`. */
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function createRunFolders(dataDir: string) {
	const root = join(dataDir, "run-folders");

	/** The run's folder on this computer, made or not. Refuses an id that is not one. */
	function path(runId: string): string {
		if (!RUN_ID.test(runId)) {
			throw new Refusal("invalid", "That is not the id of a run.");
		}
		return join(root, runId);
	}

	return {
		path,
		/**
		 * Makes the run's folder, unless it is there. `made`: it was not
		 * there before, so a run that had one lost what was in it.
		 */
		async make(runId: string): Promise<{ path: string; made: boolean }> {
			const folder = path(runId);
			const before = await stat(folder).catch(() => null);
			if (before?.isDirectory()) return { path: folder, made: false };
			await mkdir(folder, { recursive: true });
			return { path: folder, made: true };
		},
		/** Removes the run's folder and its files. One that is gone already is fine. */
		async remove(runId: string): Promise<void> {
			await rm(path(runId), { recursive: true, force: true });
		},
	};
}
