/** The `gh` program on this computer (`GitHubCli`): the access, the repositories and the pull requests of a GitHub account. */

export {
	type GitHubAccess,
	type GitHubCli,
	type GitHubRepo,
	type GitHubRepoName,
	gitHubRepoLabel,
	parseGitHubRepo,
	systemGitHubCli,
} from "./github";
