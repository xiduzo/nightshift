import { Refusal } from "@nightshift/refusal";
import type { GitHubAccess } from "../../../../github";
import type { GitHubClones } from "../../application/ports";
import { type GitHubClone, NOT_A_GITHUB_REPO } from "../../domain/clones";

/**
 * `GitHubClones` in memory: the clones of a test's GitHub. A clone runs
 * until the test ends it (`finish`, `fail`), or ends at once (`instant`).
 * A repository a person enters is `owner/repo`, or a URL with
 * `github.com/` in it. Test code.
 */
export function inMemoryGitHubClones(options: { instant?: boolean } = {}) {
	const states = new Map<string, GitHubClone>();
	const ends = new Map<string, (end: GitHubClone) => void>();
	const waiting = new Map<string, Promise<GitHubClone>>();
	let access: GitHubAccess = "signed-out";
	const keyOf = (input: string) => {
		const match = /(?:github\.com[/:])?([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i.exec(
			input.trim(),
		);
		return match ? `${match[1]}/${match[2]}`.toLowerCase() : null;
	};
	const pathOf = (key: string) => `/data/projects/${key}`;
	const end = (key: string, state: GitHubClone) => {
		states.set(key, state);
		ends.get(key)?.(state);
		ends.delete(key);
		waiting.delete(key);
	};
	const twin = {
		asked: [] as string[],
		signIn(to: GitHubAccess = "signed-in") {
			access = to;
		},
		/** The clone of `repo` is done. */
		finish(repo: string) {
			const key = keyOf(repo) as string;
			end(key, { state: "done", repo, path: pathOf(key), reused: false });
		},
		/** The clone of `repo` failed with `problem`. */
		fail(repo: string, problem: string) {
			end(keyOf(repo) as string, { state: "failed", repo, problem });
		},
		async access() {
			return access;
		},
		async repos() {
			return access === "signed-in"
				? [{ name: "acme/app", description: null, private: true }]
				: [];
		},
		async start(input: string): Promise<GitHubClone> {
			const key = keyOf(input);
			if (key === null) throw new Refusal("invalid", NOT_A_GITHUB_REPO);
			const running = states.get(key);
			if (running?.state === "cloning") return running;
			twin.asked.push(key);
			if (running?.state === "done") {
				const reused: GitHubClone = { ...running, reused: true };
				states.set(key, reused);
				return reused;
			}
			const cloning: GitHubClone = { state: "cloning", repo: input };
			states.set(key, cloning);
			waiting.set(key, new Promise((resolve) => ends.set(key, resolve)));
			if (options.instant) twin.finish(input);
			return states.get(key) ?? cloning;
		},
		status(input: string) {
			const key = keyOf(input);
			return key === null ? null : (states.get(key) ?? null);
		},
		async copy(input: string) {
			const started = await twin.start(input);
			if (started.state !== "cloning") return started;
			const key = keyOf(input) as string;
			return (await waiting.get(key)) ?? states.get(key) ?? started;
		},
	};
	return twin satisfies GitHubClones;
}

export type InMemoryGitHubClones = ReturnType<typeof inMemoryGitHubClones>;
