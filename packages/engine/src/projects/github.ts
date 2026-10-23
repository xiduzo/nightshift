import { type GitResult, type GitRunOptions, runProcess } from "./git";

/**
 * GitHub, for a project added from a repository there. `parseGitHubRepo`
 * reads what a person enters. The GitHub port (`GitHubCli`) holds every `gh`
 * process: whether `gh` is signed in, the person's repositories, and a
 * clone with `gh`'s own sign-in. `systemGitHubCli()` is the adapter over the
 * `gh` program on this computer. A test passes its own.
 */

/** A repository on GitHub, as `owner` and `repo`. */
export type GitHubRepoName = { owner: string; repo: string };

/**
 * The GitHub CLI on this computer.
 * - `missing`: `gh` is not installed.
 * - `signed-out`: `gh` is there, without a sign-in to github.com.
 * - `signed-in`: `gh` can open the person's repositories, private ones too.
 */
export type GitHubAccess = "missing" | "signed-out" | "signed-in";

/** One repository the person can open on GitHub. */
export type GitHubRepo = {
	/** `owner/repo`. */
	name: string;
	description: string | null;
	private: boolean;
};

export type GitHubCli = {
	access(): Promise<GitHubAccess>;
	/** The repositories of the signed-in person and their organizations, latest push first. */
	repos(): Promise<GitHubRepo[]>;
	/** `gh repo clone owner/repo <into>`, in `cwd`. */
	clone(
		repo: GitHubRepoName,
		into: string,
		cwd: string,
		options?: GitRunOptions,
	): Promise<GitResult>;
};

/** A GitHub user or organization name: letters, digits and single dashes, at most 39. */
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
/** A GitHub repository name: letters, digits, `.`, `-` and `_`, at most 100. */
const REPO = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * The repository a person enters: `owner/repo`, an https link
 * (`https://github.com/owner/repo`, with or without `.git` and a page after
 * it), or an ssh address (`git@github.com:owner/repo.git`,
 * `ssh://git@github.com/owner/repo`). Null for anything else, a repository
 * on another host too.
 */
export function parseGitHubRepo(input: string): GitHubRepoName | null {
	const text = input.trim();
	const path =
		/^git@github\.com:(.+)$/i.exec(text)?.[1] ??
		/^(?:https?|ssh|git):\/\/(?:[^@/]+@)?(?:www\.)?github\.com(?::\d+)?\/(.+)$/i.exec(
			text,
		)?.[1] ??
		/^(?:www\.)?github\.com\/(.+)$/i.exec(text)?.[1] ??
		/^([^:/\s]+\/[^/\s]+?)\/?$/.exec(text)?.[1] ??
		null;
	if (path === null) return null;
	// A link may go on to a page of the repository: /tree/main, /issues, ?tab=.
	const [owner = "", rawRepo = ""] = path.split(/[?#]/)[0]?.split("/") ?? [];
	const repo = rawRepo.replace(/\.git$/i, "");
	if (!OWNER.test(owner) || !REPO.test(repo)) return null;
	if (repo === "." || repo === "..") return null;
	return { owner, repo };
}

/** `owner/repo`. */
export function gitHubRepoLabel(name: GitHubRepoName): string {
	return `${name.owner}/${name.repo}`;
}

/** How long asking `gh` about the sign-in or the repositories may take. */
const ASK_TIMEOUT_MS = 20_000;

/** Every `gh` process: never a prompt, never a pager. */
const GH_ENV = {
	GH_PROMPT_DISABLED: "1",
	GH_NO_UPDATE_NOTIFIER: "1",
	GIT_TERMINAL_PROMPT: "0",
	NO_COLOR: "1",
};

type GhDeps = {
	which: (name: string) => string | null;
	run: (
		argv: string[],
		cwd: string,
		options: GitRunOptions,
	) => Promise<GitResult>;
};

/** The `gh` program on this computer. */
export function systemGitHubCli(
	deps: GhDeps = { which: (name) => Bun.which(name), run: runProcess },
): GitHubCli {
	const gh = (args: string[], cwd: string, options: GitRunOptions = {}) =>
		deps.run(["gh", ...args], cwd, {
			...options,
			env: { ...GH_ENV, ...options.env },
		});
	return {
		async access() {
			if (deps.which("gh") === null) return "missing";
			const result = await gh(
				["auth", "status", "--hostname", "github.com"],
				process.cwd(),
				{ timeoutMs: ASK_TIMEOUT_MS },
			).catch(() => null);
			return result?.exitCode === 0 ? "signed-in" : "signed-out";
		},
		async repos() {
			if (deps.which("gh") === null) return [];
			const result = await gh(
				[
					"api",
					"user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member",
				],
				process.cwd(),
				{ timeoutMs: ASK_TIMEOUT_MS },
			);
			if (result.exitCode !== 0) {
				throw new Error(
					"GitHub did not list your repositories. Try again, or enter one yourself.",
				);
			}
			return reposOf(result.stdout);
		},
		clone(repo, into, cwd, options = {}) {
			return gh(
				["repo", "clone", gitHubRepoLabel(repo), into, "--", "--quiet"],
				cwd,
				options,
			);
		},
	};
}

/** The repositories in a reply of the GitHub API (`GET /user/repos`). */
export function reposOf(json: string): GitHubRepo[] {
	let rows: unknown;
	try {
		rows = JSON.parse(json);
	} catch {
		return [];
	}
	if (!Array.isArray(rows)) return [];
	const repos: GitHubRepo[] = [];
	for (const row of rows) {
		if (typeof row !== "object" || row === null) continue;
		const {
			full_name,
			description,
			private: isPrivate,
		} = row as Record<string, unknown>;
		if (typeof full_name !== "string") continue;
		repos.push({
			name: full_name,
			description: typeof description === "string" ? description : null,
			private: isPrivate === true,
		});
	}
	return repos;
}
