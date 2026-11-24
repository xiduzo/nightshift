import type { ComputerAccess } from "../../../access";
import type { Actor } from "../../../contract";
import type { GitHubClone } from "../domain/clones";
import type { GitHubClones } from "./ports";

export type ReadGitHubClonePorts = {
	computerAccess: Pick<ComputerAccess, "openComputer">;
	gitHub: Pick<GitHubClones, "status">;
};

/** The repository a person entered. */
export type ReadGitHubClone = { repo: string };

/**
 * How the clone of a repository goes. Null: none started. It stays synchronous.
 * Only the owner of this computer may (`computerAccess.openComputer`).
 */
export const readGitHubClone =
	(ports: ReadGitHubClonePorts) =>
	(actor: Actor, request: ReadGitHubClone): GitHubClone | null => {
		ports.computerAccess.openComputer(actor);
		return ports.gitHub.status(request.repo);
	};
