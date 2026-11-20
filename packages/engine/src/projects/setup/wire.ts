import { findProgram } from "@nightshift/agents/types";
import {
	type Git,
	type GitInstall,
	systemGit,
	systemGitInstaller,
} from "../../git";
import { nodeProjectFolders } from "./adapters/out/node-project-folders";
import { checkProjectFolder } from "./application/check-project-folder";
import { installGit } from "./application/install-git";
import type { GitInstaller, Programs } from "./application/ports";
import { setUpGit } from "./application/set-up-git";
import type { ProjectReadiness } from "./domain/readiness";

/**
 * The wiring of the setup of a project folder: the one place that builds
 * its real adapter (the folders and git of this computer) and binds each
 * use case to its ports. The daemon calls it for the setup routes, the
 * local Device for the check before a run.
 */

/** What the setup stands on. Each has the one of this computer as default. */
export type SetupDeps = {
	git?: Git;
	programs?: Programs;
	installer?: GitInstaller;
};

/** The use cases of the setup, bound to their ports. */
export type Setup = {
	/** What a folder needs before runs can start in it. */
	check(path: string): Promise<ProjectReadiness>;
	/** Makes a folder a git repository with a first commit. */
	setUpGit(input: {
		path: string;
		name?: string;
		email?: string;
	}): Promise<ProjectReadiness>;
	/** Starts the git installer of this computer, or says what to run. */
	installGit(): Promise<GitInstall>;
};

export function wireSetup(deps: SetupDeps = {}): Setup {
	const folders = nodeProjectFolders(deps.git ?? systemGit());
	const programs = deps.programs ?? {
		which: (name: string) => findProgram(name),
		platform: process.platform,
	};
	const check = checkProjectFolder({ folders, programs });
	const setUp = setUpGit({ folders, check });
	const install = installGit({
		installer: deps.installer ?? systemGitInstaller(),
	});
	return {
		check: (path) => check({ path }),
		setUpGit: (input) => setUp(input),
		installGit: () => install(),
	};
}
