import { randomUUID } from "node:crypto";
import { mkdir, readdir, realpath, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Refusal } from "@nightshift/refusal";

import { type Git, GitNotInstalledError, systemGit } from "../../../../git";
import {
	type GitHubCli,
	type GitHubRepoName,
	gitHubRepoLabel,
	parseGitHubRepo,
	systemGitHubCli,
} from "../../../../github";
import { normaliseRemote } from "../../../keep";
import type { GitHubClones } from "../../application/ports";
import {
	CLONE_TIMEOUT_MS,
	type CloneTracker,
	cloneProblem,
	couldNotClone,
	folderTaken,
	type GitHubClone,
	NOT_A_GITHUB_REPO,
} from "../../domain/clones";

/** The folder of a repository in the managed projects folder. */
export function gitHubClonePath(dataDir: string, name: GitHubRepoName): string {
	return join(
		dataDir,
		"projects",
		name.owner.toLowerCase(),
		name.repo.toLowerCase(),
	);
}

/**
 * `GitHubClones` over git and `gh` on this computer. Night Shift clones
 * into a hidden folder next to the final one and renames it when git is
 * done, so a clone that fails or stops leaves nothing half done. The
 * clones that run live in `tracker`, which the daemon keeps across a
 * reload. `wireCopies` builds it.
 */
export function nodeGitHubClones(deps: {
	dataDir: string;
	tracker: CloneTracker;
	/** The git port. Default: the git programs on this computer. */
	git?: Git;
	/** The GitHub port. Default: `gh` on this computer. */
	gh?: GitHubCli;
	timeoutMs?: number;
}): GitHubClones {
	const git = deps.git ?? systemGit();
	const gh = deps.gh ?? systemGitHubCli();
	const timeoutMs = deps.timeoutMs ?? CLONE_TIMEOUT_MS;
	const { states, ends, starting } = deps.tracker;
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

	const taken = folderTaken;

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
						: couldNotClone(label),
			};
		} finally {
			await rm(temporary, { recursive: true, force: true }).catch(() => {});
		}
	}

	/** Looks at the repository's folder and starts its clone, unless the folder holds it. */
	async function begin(
		name: GitHubRepoName,
		key: string,
	): Promise<GitHubClone> {
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
			states.set(key, done);
			return done;
		}
		if (found === "other") {
			const failed: GitHubClone = {
				state: "failed",
				repo: label,
				problem: taken(path),
			};
			states.set(key, failed);
			return failed;
		}
		if (found === "empty") await rm(path, { recursive: true, force: true });

		const cloning: GitHubClone = { state: "cloning", repo: label };
		states.set(key, cloning);
		// Not awaited: the clone may take minutes. `clone` catches its own errors.
		const ended = clone(name, label, path)
			.catch(
				(): GitHubClone => ({
					state: "failed",
					repo: label,
					problem: couldNotClone(label),
				}),
			)
			.then((end) => {
				if (end.state === "failed") {
					console.warn(`[projects] clone of ${label} failed: ${end.problem}`);
				}
				states.set(key, end);
				ends.delete(key);
				return end;
			});
		ends.set(key, ended);
		return cloning;
	}

	const clones: GitHubClones = {
		access: () => gh.access(),
		async repos() {
			return (await gh.access()) === "signed-in" ? gh.repos() : [];
		},
		async start(input) {
			const name = parseGitHubRepo(input);
			if (name === null) throw new Refusal("invalid", NOT_A_GITHUB_REPO);
			const key = keyOf(name);
			const running = states.get(key);
			if (running?.state === "cloning") return running;
			// Two starts at once look at the folder once and clone once.
			const pending = starting.get(key);
			if (pending) return pending;
			const begun = begin(name, key).finally(() => starting.delete(key));
			starting.set(key, begun);
			return begun;
		},
		status(input) {
			const name = parseGitHubRepo(input);
			return name === null ? null : (states.get(keyOf(name)) ?? null);
		},
		async copy(input) {
			const started = await clones.start(input);
			if (started.state !== "cloning") return started;
			const name = parseGitHubRepo(input);
			const ended = name && ends.get(keyOf(name));
			return ended ? await ended : (clones.status(input) ?? started);
		},
	};
	return clones;
}
