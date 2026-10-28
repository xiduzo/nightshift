import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { mustGit } from "../testing/test-support";
import type { GitHubClone } from "./github-clone";
import {
	type CopySpace,
	createProjectCopies,
	NOT_ON_GITHUB,
} from "./project-copies";
import type { Project } from "./projects";

let root: string;

beforeEach(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "ns-copies-")));
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

function project(id: string, remote: string | null): Project {
	return {
		id,
		name: id,
		repoPath: null,
		remote,
		createdAt: 0,
		clones: [],
	};
}

/** A Space whose `addProject` gives the project with that remote a Clone here. */
function fakeSpace(projects: Project[]): CopySpace & { added: string[] } {
	const added: string[] = [];
	return {
		added,
		async listProjects() {
			return projects;
		},
		async addProject({ repoPath }) {
			added.push(repoPath);
			const origin = await mustGit(repoPath, ["remote", "get-url", "origin"]);
			const found = projects.find(
				(p) =>
					p.remote && origin.includes(p.remote.split("/").slice(1).join("/")),
			);
			if (!found) throw new Error(`No project has origin ${origin}`);
			found.repoPath = repoPath;
			return found;
		},
	};
}

/** A folder like a clone from GitHub, with `origin` set to `url`. */
async function cloneAt(name: string, url: string): Promise<string> {
	const path = join(root, name);
	await mkdir(path);
	await mustGit(path, ["init", "-q", "-b", "main"]);
	await mustGit(path, ["remote", "add", "origin", url]);
	return path;
}

function copies(
	space: CopySpace,
	clone: (repo: string) => Promise<GitHubClone>,
	options: { enabled?: () => boolean; now?: () => number } = {},
) {
	const asked: string[] = [];
	const service = createProjectCopies({
		gitHub: {
			copy: (repo) => {
				asked.push(repo);
				return clone(repo);
			},
		},
		spaceIds: async () => ["space-1"],
		space: () => space,
		enabled: options.enabled ?? (() => true),
		now: options.now,
	});
	return { service, asked };
}

describe("sweep", () => {
	test("copies each project from GitHub that has no Clone here", async () => {
		const path = await cloneAt("app", "https://github.com/acme/app.git");
		const space = fakeSpace([
			project("app", "github.com/acme/app"),
			project("local", null),
		]);
		const { service, asked } = copies(space, async (repo) => ({
			state: "done",
			repo,
			path,
			reused: false,
		}));

		await service.sweep();

		expect(asked).toEqual(["github.com/acme/app"]);
		expect(space.added).toEqual([path]);
		expect(service.list()).toEqual([]);

		// A project with a Clone here is not copied again.
		await service.sweep();
		expect(asked).toHaveLength(1);
	});

	test("copies nothing when it is off", async () => {
		const space = fakeSpace([project("app", "github.com/acme/app")]);
		const { service, asked } = copies(
			space,
			async () => {
				throw new Error("not called");
			},
			{ enabled: () => false },
		);
		await service.sweep();
		expect(asked).toEqual([]);
	});

	test("tries a failed copy again only after a wait, a person at once", async () => {
		let now = 0;
		const space = fakeSpace([project("app", "github.com/acme/app")]);
		const { service, asked } = copies(
			space,
			async (repo) => ({ state: "failed", repo, problem: "No access." }),
			{ now: () => now },
		);

		await service.sweep();
		expect(service.list()).toEqual([
			{ projectId: "app", state: "failed", problem: "No access." },
		]);

		await service.sweep();
		expect(asked).toHaveLength(1);

		now += 5 * 60_000;
		await service.sweep();
		expect(asked).toHaveLength(2);

		await service.copy(space, "app");
		expect(asked).toHaveLength(3);
	});

	test("says a project from another git host cannot be copied", async () => {
		const space = fakeSpace([project("lab", "gitlab.com/acme/lab")]);
		const { service, asked } = copies(space, async () => {
			throw new Error("not called");
		});
		await service.sweep();
		expect(asked).toEqual([]);
		expect(service.list()).toEqual([
			{ projectId: "lab", state: "failed", problem: NOT_ON_GITHUB },
		]);
	});
});

describe("copy", () => {
	test("names the repository in the case of the project's remote", async () => {
		// GitHub's own case, from the clone; the project's remote, from a person's clone.
		const path = await cloneAt("app", "git@github.com:Acme/App.git");
		const space = fakeSpace([project("app", "github.com/acme/app")]);
		const { service } = copies(space, async (repo) => ({
			state: "done",
			repo,
			path,
			reused: false,
		}));

		expect(await service.copy(space, "app")).toBeNull();
		expect(await mustGit(path, ["remote", "get-url", "origin"])).toBe(
			"git@github.com:acme/app.git",
		);
		expect(space.added).toEqual([path]);
	});

	test("refuses a folder that holds another repository", async () => {
		const path = await cloneAt("app", "https://github.com/acme/other.git");
		const space = fakeSpace([project("app", "github.com/acme/app")]);
		const { service } = copies(space, async (repo) => ({
			state: "done",
			repo,
			path,
			reused: true,
		}));

		const copy = await service.copy(space, "app");
		expect(copy?.state).toBe("failed");
		expect(space.added).toEqual([]);
	});

	test("joins the copy that runs", async () => {
		const path = await cloneAt("app", "https://github.com/acme/app.git");
		const space = fakeSpace([project("app", "github.com/acme/app")]);
		let finish = () => {};
		const { service, asked } = copies(
			space,
			(repo) =>
				new Promise((resolve) => {
					finish = () => resolve({ state: "done", repo, path, reused: false });
				}),
		);

		const first = service.copy(space, "app");
		const second = service.copy(space, "app");
		await Bun.sleep(0);
		expect(service.list()).toEqual([
			{ projectId: "app", state: "copying", problem: null },
		]);
		finish();
		await Promise.all([first, second]);
		expect(asked).toHaveLength(1);
	});
});
