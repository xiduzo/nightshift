import type { GitHubClone } from "../domain/clones";
import type { GitHubClones } from "./ports";

export type StartGitHubClonePorts = { gitHub: Pick<GitHubClones, "start"> };

/** The repository a person entered. */
export type StartGitHubClone = { repo: string };

/**
 * Starts a clone of a GitHub repository into Night Shift's projects
 * folder, or uses the clone that is there. Returns at once. The door
 * checks the owner of this computer.
 */
export const startGitHubClone =
	(ports: StartGitHubClonePorts) =>
	(request: StartGitHubClone): Promise<GitHubClone> =>
		ports.gitHub.start(request.repo);
