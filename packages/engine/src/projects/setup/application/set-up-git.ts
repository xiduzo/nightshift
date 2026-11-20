import { Refusal } from "@nightshift/refusal";
import {
	NO_IDENTITY,
	type ProjectReadiness,
	STARTER_GITIGNORE,
	setUpBlocker,
} from "../domain/readiness";
import type { CheckProjectFolder } from "./check-project-folder";
import type { ProjectFolders } from "./ports";

export type SetUpGitPorts = {
	folders: Pick<
		ProjectFolders,
		| "realpath"
		| "init"
		| "setIdentity"
		| "hasIdentity"
		| "hasGitignore"
		| "writeGitignore"
		| "hasCommit"
		| "commitAll"
	>;
	/** The check of the folder (`checkProjectFolder`), before and after. */
	check(request: CheckProjectFolder): Promise<ProjectReadiness>;
};

/** The folder, and a name and email for its own git config. */
export type SetUpGit = { path: string; name?: string; email?: string };

/**
 * The `set-up-git` fix. Makes the folder a repository when it is not one,
 * sets a name and email in the repository's own config when given (never the
 * global config), writes a starter `.gitignore` when there is none, and makes
 * a first commit of every file when there is no commit. Returns the folder's
 * readiness after. The door checks the owner of this computer.
 */
export const setUpGit =
	(ports: SetUpGitPorts) =>
	async (request: SetUpGit): Promise<ProjectReadiness> => {
		const { folders } = ports;
		const before = await ports.check({ path: request.path });
		const blocker = setUpBlocker(before);
		if (blocker) {
			throw new Refusal(
				"conflict",
				blocker.problem ?? "The folder is not ready.",
			);
		}
		if (before.ready) return before;

		const dir = await folders.realpath(request.path);
		if (before.topLevel === null) await folders.init(dir);
		const name = request.name?.trim();
		const email = request.email?.trim();
		if (name) await folders.setIdentity(dir, "user.name", name);
		if (email) await folders.setIdentity(dir, "user.email", email);
		if (!(await folders.hasIdentity(dir))) {
			throw new Refusal("invalid", NO_IDENTITY);
		}
		if (!(await folders.hasGitignore(dir))) {
			await folders.writeGitignore(dir, STARTER_GITIGNORE);
		}
		if (!(await folders.hasCommit(dir))) {
			await folders.commitAll(dir, "Initial commit");
		}
		return ports.check({ path: request.path });
	};
