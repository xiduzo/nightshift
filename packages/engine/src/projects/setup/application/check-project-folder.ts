import {
	checkTools,
	failed,
	insideProject,
	NO_COMMIT,
	NO_GIT,
	NO_IDENTITY,
	NO_SUCH_FOLDER,
	NOT_A_REPOSITORY,
	ok,
	type ProjectReadiness,
	readinessOf,
	skipped,
} from "../domain/readiness";
import type { Programs, ProjectFolders } from "./ports";

export type CheckProjectFolderPorts = {
	folders: Pick<
		ProjectFolders,
		| "gitInstalled"
		| "isDirectory"
		| "realpath"
		| "topLevel"
		| "hasCommit"
		| "hasIdentity"
	>;
	programs: Programs;
};

/** The folder to check. */
export type CheckProjectFolder = { path: string };

/**
 * What the folder needs before runs can start in it: git, the top folder
 * of a repository, a first commit, and a name and email for git when
 * Night Shift must make that commit. Then the programs of the knowledge
 * sources. Read-only. The door checks the owner of this computer.
 */
export const checkProjectFolder =
	(ports: CheckProjectFolderPorts) =>
	async (request: CheckProjectFolder): Promise<ProjectReadiness> => {
		const { path } = request;
		const { folders } = ports;
		const tools = checkTools(ports.programs);
		const result = (
			steps: Parameters<typeof readinessOf>[1],
			topLevel: string | null = null,
		) => readinessOf(path, steps, topLevel, tools);

		if (!(await folders.gitInstalled())) {
			return result([
				failed("git", NO_GIT, "install-git"),
				skipped("folder"),
				skipped("commit"),
			]);
		}
		if (!(await folders.isDirectory(path))) {
			return result([
				ok("git"),
				failed("folder", NO_SUCH_FOLDER, null),
				skipped("commit"),
			]);
		}
		const dir = await folders.realpath(path);
		const topLevel = await folders.topLevel(dir);
		if (topLevel === null) {
			return result([
				ok("git"),
				failed("folder", NOT_A_REPOSITORY, "set-up-git"),
				failed("commit", NO_COMMIT, "set-up-git"),
				(await folders.hasIdentity(dir))
					? ok("identity")
					: failed("identity", NO_IDENTITY, "set-up-git"),
			]);
		}
		if (topLevel !== dir) {
			return result(
				[
					ok("git"),
					failed("folder", insideProject(topLevel), "use-top-folder"),
					skipped("commit"),
				],
				topLevel,
			);
		}
		if (await folders.hasCommit(dir)) {
			return result([ok("git"), ok("folder"), ok("commit")], topLevel);
		}
		return result(
			[
				ok("git"),
				ok("folder"),
				failed("commit", NO_COMMIT, "set-up-git"),
				(await folders.hasIdentity(dir))
					? ok("identity")
					: failed("identity", NO_IDENTITY, "set-up-git"),
			],
			topLevel,
		);
	};
