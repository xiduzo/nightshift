import type { GitHubRepo } from "../../../github";
import type { GitHubClones } from "./ports";

export type ListGitHubReposPorts = { gitHub: Pick<GitHubClones, "repos"> };

/** The person's GitHub repositories, when the GitHub CLI is signed in. Else none. */
export const listGitHubRepos =
	(ports: ListGitHubReposPorts) => (): Promise<GitHubRepo[]> =>
		ports.gitHub.repos();
