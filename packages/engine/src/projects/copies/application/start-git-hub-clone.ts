import type { ComputerAccess } from "../../../access";
import type { Actor } from "../../../contract";
import type { GitHubClone } from "../domain/clones";
import type { GitHubClones } from "./ports";

export type StartGitHubClonePorts = {
	computerAccess: Pick<ComputerAccess, "openComputer">;
	gitHub: Pick<GitHubClones, "start">;
};

/** The repository a person entered. */
export type StartGitHubClone = { repo: string };

/**
 * Starts a clone of a GitHub repository into Night Shift's projects
 * folder, or uses the clone that is there. Returns at once. Only the
 * owner of this computer may (`computerAccess.openComputer`).
 */
export const startGitHubClone =
	(ports: StartGitHubClonePorts) =>
	async (actor: Actor, request: StartGitHubClone): Promise<GitHubClone> => {
		ports.computerAccess.openComputer(actor);
		return ports.gitHub.start(request.repo);
	};
