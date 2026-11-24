import type { ComputerAccess } from "../../../access";
import type { Actor } from "../../../contract";
import type { GitHubAccess } from "../../../github";
import type { GitHubClones } from "./ports";

export type ReadGitHubAccessPorts = {
	computerAccess: Pick<ComputerAccess, "openComputer">;
	gitHub: Pick<GitHubClones, "access">;
};

/**
 * The GitHub CLI on this computer: missing, signed out or signed in.
 * Only the owner of this computer may (`computerAccess.openComputer`).
 */
export const readGitHubAccess =
	(ports: ReadGitHubAccessPorts) =>
	async (actor: Actor): Promise<GitHubAccess> => {
		ports.computerAccess.openComputer(actor);
		return ports.gitHub.access();
	};
