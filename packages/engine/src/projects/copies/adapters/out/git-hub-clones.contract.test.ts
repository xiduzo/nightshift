import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type Git, systemGit } from "../../../../git";
import type { GitHubAccess, GitHubCli } from "../../../../github";
import { commitFile, mustGit } from "../../../../testing/test-support";
import { createCloneTracker } from "../../domain/clones";
import { gitHubClonesContract } from "./git-hub-clones.contract";
import { inMemoryGitHubClones } from "./in-memory-git-hub-clones";
import { nodeGitHubClones } from "./node-git-hub-clones";

/**
 * The contract of `GitHubClones`, on both adapters. The real adapter's
 * side clones a repository in a temporary folder that stands in for the
 * one on GitHub.
 */

gitHubClonesContract("in memory", async () => {
	const gitHubClones = inMemoryGitHubClones({ instant: true });
	return {
		gitHubClones,
		signIn: () => gitHubClones.signIn(),
		close: async () => {},
	};
});

gitHubClonesContract("over git and gh", async () => {
	const root = await realpath(await mkdtemp(join(tmpdir(), "ns-clones-")));
	const upstream = join(root, "upstream");
	await mkdir(upstream);
	await mustGit(upstream, ["init", "-q", "-b", "main"]);
	await commitFile(upstream, "README.md");
	/** Clones `upstream` where a clone from GitHub would go, with GitHub as its origin. */
	async function fakeClone(into: string, cwd: string, url: string) {
		const target = resolve(cwd, into);
		await mustGit(cwd, ["clone", "-q", upstream, target]);
		await mustGit(target, ["remote", "set-url", "origin", url]);
		return { exitCode: 0, stdout: "", stderr: "" };
	}
	const real = systemGit();
	const git: Git = {
		...real,
		async run(cwd, args, options) {
			if (args[0] !== "clone") return real.run(cwd, args, options);
			return fakeClone(args.at(-1) ?? "", cwd, args.at(-2) ?? "");
		},
	};
	let access: GitHubAccess = "signed-out";
	const gh: GitHubCli = {
		access: async () => access,
		repos: async () => [{ name: "acme/app", description: null, private: true }],
		viewPullRequest: async () => null,
		clone: (repo, into, cwd) =>
			fakeClone(into, cwd, `git@github.com:${repo.owner}/${repo.repo}.git`),
	};
	return {
		gitHubClones: nodeGitHubClones({
			dataDir: join(root, "data"),
			tracker: createCloneTracker(),
			git,
			gh,
		}),
		signIn: () => {
			access = "signed-in";
		},
		close: () => rm(root, { recursive: true, force: true }),
	};
});
