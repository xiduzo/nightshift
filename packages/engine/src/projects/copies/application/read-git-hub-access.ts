import type { GitHubAccess } from "../../../github";
import type { GitHubClones } from "./ports";

export type ReadGitHubAccessPorts = { gitHub: Pick<GitHubClones, "access"> };

/** The GitHub CLI on this computer: missing, signed out or signed in. */
export const readGitHubAccess =
	(ports: ReadGitHubAccessPorts) => (): Promise<GitHubAccess> =>
		ports.gitHub.access();
