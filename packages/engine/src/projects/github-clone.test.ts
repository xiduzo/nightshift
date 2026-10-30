import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
	mkdir,
	mkdtemp,
	readdir,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { commitFile, mustGit } from "../testing/test-support";
import { type Git, type GitResult, systemGit } from "./git";
import type { GitHubAccess, GitHubCli } from "./github";
import {
	cloneProblem,
	createGitHubClones,
	type GitHubClone,
	type GitHubClones,
	gitHubClonePath,
	NOT_A_GITHUB_REPO,
} from "./github-clone";

let root: string;
let dataDir: string;
/** The repository that stands in for the one on GitHub. */
let upstream: string;

beforeEach(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "ns-github-")));
	dataDir = join(root, "data");
	upstream = join(root, "upstream");
	await mkdir(upstream);
	await mustGit(upstream, ["init", "-q", "-b", "main"]);
	await commitFile(upstream, "README.md");
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

/** Clones `upstream` where a clone from GitHub would go, with GitHub as its origin. */
async function fakeClone(into: string, cwd: string, url: string) {
	const target = resolve(cwd, into);
	await mustGit(cwd, ["clone", "-q", upstream, target]);
	await mustGit(target, ["remote", "set-url", "origin", url]);
	return { exitCode: 0, stdout: "", stderr: "" };
}

type Seen = { gitClones: string[][]; ghClones: string[] };

function ports(
	access: GitHubAccess,
	fail?: GitResult,
): { git: Git; gh: GitHubCli; seen: Seen } {
	const seen: Seen = { gitClones: [], ghClones: [] };
	const real = systemGit();
	const git: Git = {
		...real,
		async run(cwd, args, options) {
			if (args[0] !== "clone") return real.run(cwd, args, options);
			seen.gitClones.push(args);
			if (fail) return fail;
			const url = args.at(-2) ?? "";
			return fakeClone(args.at(-1) ?? "", cwd, url);
		},
	};
	const gh: GitHubCli = {
		access: async () => access,
		repos: async () => [{ name: "acme/app", description: null, private: true }],
		async clone(repo, into, cwd) {
			seen.ghClones.push(`${repo.owner}/${repo.repo}`);
			if (fail) return fail;
			return fakeClone(
				into,
				cwd,
				`git@github.com:${repo.owner}/${repo.repo}.git`,
			);
		},
	};
	return { git, gh, seen };
}

async function settle(
	clones: GitHubClones,
	repo: string,
): Promise<GitHubClone> {
	for (let i = 0; i < 200; i++) {
		const status = clones.status(repo);
		if (status && status.state !== "cloning") return status;
		await Bun.sleep(20);
	}
	throw new Error("The clone did not end.");
}

describe("createGitHubClones", () => {
	test("clones with git into the managed folder when gh is not signed in", async () => {
		const { git, gh, seen } = ports("signed-out");
		const clones = createGitHubClones({ dataDir, git, gh });
		expect(await clones.start("https://github.com/Acme/App")).toEqual({
			state: "cloning",
			repo: "Acme/App",
		});
		const path = join(dataDir, "projects", "acme", "app");
		expect(await settle(clones, "acme/app")).toEqual({
			state: "done",
			repo: "Acme/App",
			path,
			reused: false,
		});
		expect(seen.gitClones).toEqual([
			[
				"clone",
				"--quiet",
				"--",
				"https://github.com/Acme/App.git",
				expect.stringMatching(/\.app\.cloning-/),
			],
		]);
		expect(existsSync(join(path, "README.md"))).toBe(true);
		// Nothing half done is left next to it.
		expect(await readdir(join(dataDir, "projects", "acme"))).toEqual(["app"]);
	});

	test("clones with gh when it is signed in", async () => {
		const { git, gh, seen } = ports("signed-in");
		const clones = createGitHubClones({ dataDir, git, gh });
		await clones.start("acme/app");
		expect((await settle(clones, "acme/app")).state).toBe("done");
		expect(seen.ghClones).toEqual(["acme/app"]);
		expect(seen.gitClones).toEqual([]);
	});

	test("copy waits for the clone, and joins the one that runs", async () => {
		const { git, gh, seen } = ports("signed-in");
		const clones = createGitHubClones({ dataDir, git, gh });
		const [first, second] = await Promise.all([
			clones.copy("github.com/acme/app"),
			clones.copy("acme/app"),
		]);
		const path = gitHubClonePath(dataDir, { owner: "acme", repo: "app" });
		expect(first).toEqual({
			state: "done",
			repo: "acme/app",
			path,
			reused: false,
		});
		expect(second.state).toBe("done");
		expect(seen.ghClones).toEqual(["acme/app"]);
	});

	test("uses a clone of the same repository that is already there", async () => {
		const { git, gh, seen } = ports("signed-out");
		const clones = createGitHubClones({ dataDir, git, gh });
		await clones.start("acme/app");
		await settle(clones, "acme/app");
		const again = createGitHubClones({ dataDir, git, gh });
		expect(await again.start("git@github.com:acme/app.git")).toEqual({
			state: "done",
			repo: "acme/app",
			path: gitHubClonePath(dataDir, { owner: "acme", repo: "app" }),
			reused: true,
		});
		expect(seen.gitClones).toHaveLength(1);
	});

	test("refuses a folder that holds something else", async () => {
		const { git, gh, seen } = ports("signed-out");
		const path = gitHubClonePath(dataDir, { owner: "acme", repo: "app" });
		await mkdir(path, { recursive: true });
		await writeFile(join(path, "notes.txt"), "mine\n");
		const clones = createGitHubClones({ dataDir, git, gh });
		const result = await clones.start("acme/app");
		expect(result.state).toBe("failed");
		expect(result.state === "failed" && result.problem).toContain(
			"already holds other files",
		);
		expect(seen.gitClones).toEqual([]);
	});

	test("clones into an empty folder that is there", async () => {
		const { git, gh } = ports("signed-out");
		const path = gitHubClonePath(dataDir, { owner: "acme", repo: "app" });
		await mkdir(path, { recursive: true });
		const clones = createGitHubClones({ dataDir, git, gh });
		await clones.start("acme/app");
		expect((await settle(clones, "acme/app")).state).toBe("done");
	});

	test("joins a clone that runs instead of starting another", async () => {
		const { git, gh, seen } = ports("signed-out");
		const clones = createGitHubClones({ dataDir, git, gh });
		await clones.start("acme/app");
		expect((await clones.start("Acme/App")).state).toBe("cloning");
		await settle(clones, "acme/app");
		expect(seen.gitClones).toHaveLength(1);
	});

	test("says how to fix a failed clone, and leaves nothing behind", async () => {
		const { git, gh } = ports("signed-out", {
			exitCode: 128,
			stdout: "",
			stderr:
				"fatal: could not read Username for 'https://github.com': terminal prompts disabled",
		});
		const clones = createGitHubClones({ dataDir, git, gh });
		await clones.start("acme/secret");
		const result = await settle(clones, "acme/secret");
		expect(result).toEqual({
			state: "failed",
			repo: "acme/secret",
			problem:
				"GitHub refused access to acme/secret. To sign in to GitHub, run gh auth login on this computer.",
		});
		expect(await readdir(join(dataDir, "projects", "acme"))).toEqual([]);
	});

	test("refuses what is not a GitHub repository", async () => {
		const { git, gh } = ports("signed-out");
		const clones = createGitHubClones({ dataDir, git, gh });
		await expect(clones.start("acme/app; rm -rf /")).rejects.toThrow(
			NOT_A_GITHUB_REPO,
		);
		expect(clones.status("nope")).toBeNull();
	});

	test("lists repositories only when gh is signed in", async () => {
		expect(
			await createGitHubClones({ dataDir, ...ports("signed-out") }).repos(),
		).toEqual([]);
		expect(
			await createGitHubClones({ dataDir, ...ports("signed-in") }).repos(),
		).toHaveLength(1);
	});
});

describe("cloneProblem", () => {
	const said = (stderr: string, timedOut?: boolean): GitResult => ({
		exitCode: 128,
		stdout: "",
		stderr,
		...(timedOut ? { timedOut } : {}),
	});

	test("a clone that took too long", () => {
		expect(cloneProblem(said("", true), "acme/app", false, 600_000)).toBe(
			"Copying acme/app took longer than 10 minutes, so Night Shift stopped. Try again later.",
		);
	});

	test("no connection", () => {
		expect(
			cloneProblem(
				said("fatal: unable to access: Could not resolve host: github.com"),
				"acme/app",
				true,
				1,
			),
		).toContain("cannot reach GitHub");
	});

	test("a repository that is not there, signed out and in", () => {
		const notFound = said("remote: Repository not found.");
		expect(cloneProblem(notFound, "acme/app", false, 1)).toContain(
			"run gh auth login",
		);
		expect(cloneProblem(notFound, "acme/app", true, 1)).toBe(
			"GitHub has no repository acme/app that you can open. Check the name and your access.",
		);
	});

	test("anything else", () => {
		expect(cloneProblem(said("boom"), "acme/app", false, 1)).toBe(
			"Night Shift could not copy acme/app from GitHub. Try again.",
		);
	});
});
