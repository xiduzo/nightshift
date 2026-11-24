import type { ComputerAccess } from "../../../access";
import type { Actor } from "../../../contract";
import type { GitInstall } from "../../../git";
import type { GitInstaller } from "./ports";

export type InstallGitPorts = {
	computerAccess: Pick<ComputerAccess, "openComputer">;
	installer: GitInstaller;
};

/**
 * The `install-git` fix: starts the git installer of this computer, or
 * says what to run. Only the owner of this computer may
 * (`computerAccess.openComputer`).
 */
export const installGit =
	(ports: InstallGitPorts) =>
	async (actor: Actor): Promise<GitInstall> => {
		ports.computerAccess.openComputer(actor);
		return ports.installer.install();
	};
