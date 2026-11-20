import type { GitInstall } from "../../../git";
import type { GitInstaller } from "./ports";

export type InstallGitPorts = {
	installer: GitInstaller;
};

/**
 * The `install-git` fix: starts the git installer of this computer, or
 * says what to run. The door checks the owner of this computer.
 */
export const installGit =
	(ports: InstallGitPorts) => async (): Promise<GitInstall> =>
		ports.installer.install();
