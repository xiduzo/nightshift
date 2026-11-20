import { Refusal } from "@nightshift/refusal";

/** A folder without a remote, in a Space a Host keeps: the Host has nothing to copy. */
export const HOSTED_NEEDS_REMOTE =
	"Your Host keeps the projects of this Space and copies them from GitHub. Put this folder on GitHub first, then add it again.";

/** A removal while a run of the project waits at a Gate. */
export const WAITS_AT_GATE =
	"A run of this project waits at a Gate. Answer the Gate or stop the run first.";

/** A removal while a run of the project sleeps. */
export const SLEEPS =
	"A run of this project sleeps until a wait ends. Stop it first.";

/** A change while a run of the project runs a step: `what` is the change. */
export function stillRunning(what: string): string {
	return `A run of this project is still running. Stop it to ${what}.`;
}

/** A second folder of a project this computer has a Clone of. */
export function alreadyHere(path: string): string {
	return `This computer already has this project, in ${path}. Choose Change folder in its menu to use this folder instead.`;
}

/** A folder that is the Clone of another project here. */
export function folderTaken(name: string): string {
	return `This folder is the project ${name} already. Choose another folder.`;
}

/** A folder whose remote is not the project's. */
export function otherRepository(remote: string | null): string {
	return remote === null
		? "This folder has a remote repository, and this project has none. Choose the folder of this project."
		: `This folder holds another repository. Choose a copy of ${remote}.`;
}

/** The name of a new project of a folder: the one asked, else the folder's own name. */
export function folderName(path: string, name?: string): string {
	return name ?? path.split("/").at(-1) ?? path;
}

/**
 * Refuses while a run of the project runs a step on this computer, and
 * gives the ids of its runs.
 */
export async function noActiveRun(
	runs: {
		runIds(projectId: string): Promise<string[]>;
		isActive(runId: string): boolean;
	},
	projectId: string,
	what: string,
): Promise<string[]> {
	const runIds = await runs.runIds(projectId);
	if (runIds.some((id) => runs.isActive(id))) {
		throw new Refusal("conflict", stillRunning(what));
	}
	return runIds;
}
