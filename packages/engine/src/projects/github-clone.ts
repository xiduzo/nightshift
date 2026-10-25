import { randomUUID } from "node:crypto";
import { mkdir, readdir, realpath, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Refusal } from "@nightshift/refusal";

import {
	type Git,
	GitNotInstalledError,
	type GitResult,
	systemGit,
} from "./git";
import {
	type GitHubAccess,
	type GitHubCli,
	type GitHubRepo,
	type GitHubRepoName,
	gitHubRepoLabel,
	parseGitHubRepo,
	systemGitHubCli,
} from "./github";
import { normaliseRemote } from "./remote";

/**
 * Clones from GitHub into a folder Night Shift manages:
 * `<data dir>/projects/<owner>/<repo>`, in lower case. A clone runs in the
 * background, so no request waits for it: `start` returns at once and
 * `status` says how it goes. Night Shift clones into a hidden folder next to
 * the final one and renames it when git is done, so a clone that fails or
 * stops leaves nothing half done. A folder that already holds a clone of the
 * same repository is used again. The folder is then added like any other
 * (`checkProjectFolder`, `Projects.add`).
 */

/** How one clone from GitHub goes. `repo` is `owner/repo` as the person entered it. */
export type GitHubClone =
	| { state: "cloning"; repo: string }
	| { state: "done"; repo: string; path: string; reused: boolean }
	| { state: "failed"; repo: string; problem: string };

export type GitHubClones = {
	/** The GitHub CLI on this computer: missing, signed out or signed in. */
	access(): Promise<GitHubAccess>;
	/** The person's repositories, when the GitHub CLI is signed in. Else none. */
	repos(): Promise<GitHubRepo[]>;
	/**
	 * Starts a clone of the repository a person entered (`parseGitHubRepo`),
	 * or joins the one that runs. Throws when the input is not a GitHub
	 * repository.
	 */
	start(input: string): Promise<GitHubClone>;
	/** The clone of the repository, or null when none started since this daemon did. */
	status(input: string): GitHubClone | null;
};

/** How long one clone may take before Night Shift stops it. */
export const CLONE_TIMEOUT_MS = 15 * 60_000;

export const NOT_A_GITHUB_REPO =
	"Enter a GitHub repository, for example acme/app or https://github.com/acme/app.";

/** The folder of a repository in the managed projects folder. */
export function gitHubClonePath(dataDir: string, name: GitHubRepoName): string {
	return join(
		dataDir,
		"projects",
		name.owner.toLowerCase(),
		name.repo.toLowerCase(),
	);
}

export function createGitHubClones(deps: {
	dataDir: string;
	/** The git port. Default: the git programs on this computer. */
	git?: Git;
	/** The GitHub port. Default: `gh` on this computer. */
	gh?: GitHubCli;
	timeoutMs?: number;
}): GitHubClones {
	const git = deps.git ?? systemGit();
	const gh = deps.gh ?? systemGitHubCli();
	const timeoutMs = deps.timeoutMs ?? CLONE_TIMEOUT_MS;
	const clones = new Map<string, GitHubClone>();
	const keyOf = (name: GitHubRepoName) => gitHubRepoLabel(name).toLowerCase();

	/** Whether `path` is the top of a clone whose `origin` is the repository. */
	async function holdsClone(
		path: string,
		name: GitHubRepoName,
	): Promise<boolean> {
		const top = await git.run(path, ["rev-parse", "--show-toplevel"]);
		if (top.exitCode !== 0 || !top.stdout) return false;
		if ((await realpath(top.stdout)) !== (await realpath(path))) return false;
		const origin = await git.run(path, ["remote", "get-url", "origin"]);
		if (origin.exitCode !== 0) return false;
		const remote = normaliseRemote(origin.stdout)?.toLowerCase();
		return remote === `github.com/${keyOf(name)}`;
	}

	/** What is at the clone's folder: nothing, an empty folder, the clone, or other files. */
	async function existing(
		path: string,
		name: GitHubRepoName,
	): Promise<"none" | "empty" | "clone" | "other"> {
		const info = await stat(path).catch(() => null);
		if (info === null) return "none";
		if (!info.isDirectory()) return "other";
		if ((await readdir(path)).length === 0) return "empty";
		return (await holdsClone(path, name)) ? "clone" : "other";
	}

	const taken = (path: string) =>
		`The folder ${path} already holds other files. Move them away, then try again.`;

	async function clone(
		name: GitHubRepoName,
		label: string,
		path: string,
	): Promise<GitHubClone> {
		const parent = join(path, "..");
		const temporary = join(
			parent,
			`.${name.repo.toLowerCase()}.cloning-${randomUUID().slice(0, 8)}`,
		);
		try {
			await mkdir(parent, { recursive: true });
			const signedIn = (await gh.access()) === "signed-in";
			const options = { timeoutMs, env: { GIT_TERMINAL_PROMPT: "0" } };
			const result = signedIn
				? await gh.clone(name, temporary, parent, options)
				: await git.run(
						parent,
						[
							"clone",
							"--quiet",
							"--",
							`https://github.com/${name.owner}/${name.repo}.git`,
							temporary,
						],
						options,
					);
			if (result.exitCode !== 0 || result.timedOut) {
				console.warn(`[projects] git said for ${label}: ${result.stderr}`);
				return {
					state: "failed",
					repo: label,
					problem: cloneProblem(result, label, signedIn, timeoutMs),
				};
			}
			try {
				await rename(temporary, path);
			} catch {
				// Another clone of the same repository got there first.
				if ((await existing(path, name)) !== "clone") {
					return { state: "failed", repo: label, problem: taken(path) };
				}
				return { state: "done", repo: label, path, reused: true };
			}
			return { state: "done", repo: label, path, reused: false };
		} catch (error) {
			return {
				state: "failed",
				repo: label,
				problem:
					error instanceof GitNotInstalledError
						? error.message
						: `Night Shift could not copy ${label} from GitHub. Try again.`,
			};
		} finally {
			await rm(temporary, { recursive: true, force: true }).catch(() => {});
		}
	}

	return {
		access: () => gh.access(),
		async repos() {
			return (await gh.access()) === "signed-in" ? gh.repos() : [];
		},
		async start(input) {
			const name = parseGitHubRepo(input);
			if (name === null) throw new Refusal("invalid", NOT_A_GITHUB_REPO);
			const key = keyOf(name);
			const running = clones.get(key);
			if (running?.state === "cloning") return running;

			const label = gitHubRepoLabel(name);
			const path = gitHubClonePath(deps.dataDir, name);
			const found = await existing(path, name);
			if (found === "clone") {
				const done: GitHubClone = {
					state: "done",
					repo: label,
					path,
					reused: true,
				};
				clones.set(key, done);
				return done;
			}
			if (found === "other") {
				const failed: GitHubClone = {
					state: "failed",
					repo: label,
					problem: taken(path),
				};
				clones.set(key, failed);
				return failed;
			}
			if (found === "empty") await rm(path, { recursive: true, force: true });

			const cloning: GitHubClone = { state: "cloning", repo: label };
			clones.set(key, cloning);
			// Not awaited: the clone may take minutes. `clone` catches its own errors.
			void clone(name, label, path)
				.catch(
					(): GitHubClone => ({
						state: "failed",
						repo: label,
						problem: `Night Shift could not copy ${label} from GitHub. Try again.`,
					}),
				)
				.then((end) => {
					if (end.state === "failed") {
						console.warn(`[projects] clone of ${label} failed: ${end.problem}`);
					}
					clones.set(key, end);
				});
			return cloning;
		},
		status(input) {
			const name = parseGitHubRepo(input);
			return name === null ? null : (clones.get(keyOf(name)) ?? null);
		},
	};
}

/** What went wrong with a clone, and how to fix it. */
export function cloneProblem(
	result: GitResult,
	label: string,
	signedIn: boolean,
	timeoutMs: number,
): string {
	if (result.timedOut) {
		return `Copying ${label} took longer than ${Math.round(timeoutMs / 60_000)} minutes, so Night Shift stopped. Try again later.`;
	}
	const said = result.stderr.toLowerCase();
	if (
		/could not resolve host|unable to access|network is unreachable|connection timed out|failed to connect/.test(
			said,
		)
	) {
		return "Night Shift cannot reach GitHub. Check the internet connection of this computer, then try again.";
	}
	if (/not found|could not resolve to a repository|does not exist/.test(said)) {
		return signedIn
			? `GitHub has no repository ${label} that you can open. Check the name and your access.`
			: `GitHub has no public repository ${label}. Check the name. For a private repository, sign in to GitHub on this computer: run gh auth login.`;
	}
	if (
		/could not read username|authentication failed|terminal prompts disabled|permission denied|403/.test(
			said,
		)
	) {
		return signedIn
			? `GitHub refused access to ${label}. Check your access to it.`
			: `GitHub refused access to ${label}. Sign in to GitHub on this computer: run gh auth login.`;
	}
	return `Night Shift could not copy ${label} from GitHub. Try again.`;
}
