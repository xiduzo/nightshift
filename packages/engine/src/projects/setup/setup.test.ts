import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inMemoryComputer } from "../../access/computer/adapters/out/in-memory-computer";
import { type Git, systemGit } from "../../git";
import { mustGit } from "../../testing/test-support";
import { type ProjectReadiness, STARTER_GITIGNORE } from "./domain/readiness";
import { wireSetup } from "./wire";

/** The setup as the daemon wires it, with this computer's git unless a test gives one. */
const checkProjectFolder = (
	path: string,
	options: {
		git?: Git;
		tools?: { which(name: string): string | null; platform: string };
	} = {},
) =>
	wireSetup({
		computerAccess: inMemoryComputer(),
		...(options.git ? { git: options.git } : {}),
		...(options.tools ? { programs: options.tools } : {}),
	}).check(path);
const setUpGit = (
	input: { path: string; name?: string; email?: string },
	options: { git?: Git } = {},
) =>
	wireSetup({ ...options, computerAccess: inMemoryComputer() }).setUpGit(input);

/** The steps a run needs: the tools step has tests of its own. */
const statuses = (readiness: ProjectReadiness) =>
	readiness.steps
		.filter((step) => step.id !== "tools")
		.map((step) => `${step.id}:${step.status}:${step.fix}`);

// Keep the person's own git config out: no global identity unless a test sets one.
const savedEnv = {
	GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
	GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
};
let root: string;
let globalConfig: string;
beforeAll(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "ns-setup-")));
	globalConfig = join(root, "gitconfig");
	process.env.GIT_CONFIG_GLOBAL = globalConfig;
	process.env.GIT_CONFIG_NOSYSTEM = "1";
});
afterAll(async () => {
	for (const [key, value] of Object.entries(savedEnv)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	await rm(root, { recursive: true, force: true });
});

let folder: string;
beforeEach(async () => {
	await writeFile(globalConfig, "");
	folder = await mkdtemp(join(root, "project-"));
});

async function withGlobalIdentity() {
	await writeFile(
		globalConfig,
		"[user]\n\tname = Test\n\temail = test@example.com\n",
	);
}

describe("checkProjectFolder", () => {
	test("git missing stops at the first step and offers the installer", async () => {
		const readiness = await checkProjectFolder(folder, {
			git: { ...systemGit(), probe: async () => null },
		});
		expect(readiness.ready).toBe(false);
		expect(statuses(readiness)).toEqual([
			"git:failed:install-git",
			"folder:skipped:null",
			"commit:skipped:null",
		]);
		expect(readiness.steps[0]?.problem).toBe(
			"Git is not installed on this computer.",
		);
	});

	test("a global identity is enough", async () => {
		await withGlobalIdentity();
		const readiness = await checkProjectFolder(folder);
		expect(readiness.needsIdentity).toBe(false);
		expect(readiness.steps.at(-1)?.status).toBe("ok");
	});

	test("a repository without commits needs a first commit", async () => {
		await mustGit(folder, ["init", "-q"]);
		const readiness = await checkProjectFolder(folder);
		expect(statuses(readiness)).toEqual([
			"git:ok:null",
			"folder:ok:null",
			"commit:failed:set-up-git",
			"identity:failed:set-up-git",
		]);
	});
});

describe("setUpGit", () => {
	test("makes a repository, a .gitignore and a first commit of every file", async () => {
		await writeFile(join(folder, "README.md"), "hello\n");
		const readiness = await setUpGit({
			path: folder,
			name: "Ada",
			email: "ada@example.com",
		});
		expect(readiness.ready).toBe(true);
		expect(await Bun.file(join(folder, ".gitignore")).text()).toBe(
			STARTER_GITIGNORE,
		);
		expect(await mustGit(folder, ["log", "--format=%s %an"])).toBe(
			"Initial commit Ada",
		);
		expect((await mustGit(folder, ["ls-files"])).split("\n").sort()).toEqual([
			".gitignore",
			"README.md",
		]);
		// The identity goes into the repository, not the global config.
		expect(await mustGit(folder, ["config", "--local", "user.email"])).toBe(
			"ada@example.com",
		);
		expect(await Bun.file(globalConfig).text()).toBe("");
	});

	test("keeps an existing .gitignore and commits in an existing repository", async () => {
		await withGlobalIdentity();
		await mustGit(folder, ["init", "-q"]);
		await writeFile(join(folder, ".gitignore"), "dist/\n");
		const readiness = await setUpGit({ path: folder });
		expect(readiness.ready).toBe(true);
		expect(await Bun.file(join(folder, ".gitignore")).text()).toBe("dist/\n");
	});
});

describe("the programs of the knowledge sources", () => {
	test("never makes a folder not ready, and set-up still runs", async () => {
		await withGlobalIdentity();
		await mustGit(folder, ["init", "-q", "-b", "main"]);
		await writeFile(join(folder, "a.txt"), "a\n");
		await mustGit(folder, ["add", "a.txt"]);
		await mustGit(folder, ["commit", "-q", "-m", "a"]);
		const tools = { which: () => null, platform: "linux" as const };
		const readiness = await checkProjectFolder(folder, { tools });
		expect(readiness.ready).toBe(true);
		expect(readiness.steps.at(-1)).toMatchObject({
			id: "tools",
			status: "failed",
		});
		expect(readiness.toolsInstall).toEqual({
			kind: "manual",
			url: "https://curl.se/download.html",
		});
	});
});
