import type { GitHubClone } from "../domain/clones";
import type { GitHubClones } from "./ports";

export type ReadGitHubClonePorts = { gitHub: Pick<GitHubClones, "status"> };

/** The repository a person entered. */
export type ReadGitHubClone = { repo: string };

/** How the clone of a repository goes. Null: none started. It stays synchronous. */
export const readGitHubClone =
	(ports: ReadGitHubClonePorts) =>
	(request: ReadGitHubClone): GitHubClone | null =>
		ports.gitHub.status(request.repo);
