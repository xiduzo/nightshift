import type { ComputerAccess } from "../../../access";
import type { Actor } from "../../../contract";
import type { GitHubRepo } from "../../../github";
import type { GitHubClones } from "./ports";

export type ListGitHubReposPorts = {
	computerAccess: Pick<ComputerAccess, "openComputer">;
	gitHub: Pick<GitHubClones, "repos">;
};

/**
 * The person's GitHub repositories, when the GitHub CLI is signed in. Else none.
 * Only the owner of this computer may (`computerAccess.openComputer`).
 */
export const listGitHubRepos =
	(ports: ListGitHubReposPorts) =>
	async (actor: Actor): Promise<GitHubRepo[]> => {
		ports.computerAccess.openComputer(actor);
		return ports.gitHub.repos();
	};
