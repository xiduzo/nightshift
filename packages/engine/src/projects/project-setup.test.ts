import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mustGit } from "../testing/test-support";
import { GIT_DOWNLOAD_URL, systemGit, systemGitInstaller } from "./git";
import {
	checkProjectFolder,
	type ProjectReadiness,
	STARTER_GITIGNORE,
	setUpGit,
} from "./project-setup";

const statuses = (readiness: ProjectReadiness) =>
	readiness.steps.map((step) => `${step.id}:${step.status}:${step.fix}`);

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

	test("a folder that does not exist has no fix", async () => {
		const readiness = await checkProjectFolder(join(root, "nope"));
		expect(statuses(readiness)).toEqual([
			"git:ok:null",
			"folder:failed:null",
			"commit:skipped:null",
		]);
	});

	test("a plain folder needs set-up, and a name and email without one", async () => {
		const readiness = await checkProjectFolder(folder);
		expect(statuses(readiness)).toEqual([
			"git:ok:null",
			"folder:failed:set-up-git",
			"commit:failed:set-up-git",
			"identity:failed:set-up-git",
		]);
		expect(readiness.needsIdentity).toBe(true);
	});

	test("a global identity is enough", async () => {
		await withGlobalIdentity();
		const readiness = await checkProjectFolder(folder);
		expect(readiness.needsIdentity).toBe(false);
		expect(readiness.steps.at(-1)?.status).toBe("ok");
	});

	test("a subfolder offers the top folder", async () => {
		await mustGit(folder, ["init", "-q"]);
		const sub = join(folder, "packages");
		await mkdir(sub);
		const readiness = await checkProjectFolder(sub);
		expect(readiness.topLevel).toBe(folder);
		expect(statuses(readiness)).toEqual([
			"git:ok:null",
			"folder:failed:use-top-folder",
			"commit:skipped:null",
		]);
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

	test("a repository with a commit is ready, with no identity step", async () => {
		await withGlobalIdentity();
		await mustGit(folder, ["init", "-q"]);
		await mustGit(folder, ["commit", "-q", "--allow-empty", "-m", "first"]);
		const readiness = await checkProjectFolder(folder);
		expect(readiness.ready).toBe(true);
		expect(readiness.steps.map((step) => step.id)).toEqual([
			"git",
			"folder",
			"commit",
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

	test("refuses without a name and email, and changes nothing", async () => {
		await expect(setUpGit({ path: folder })).rejects.toThrow(
			"Git needs your name and email",
		);
		expect(await Bun.file(join(folder, ".gitignore")).exists()).toBe(false);
	});

	test("refuses a subfolder", async () => {
		await mustGit(folder, ["init", "-q"]);
		const sub = join(folder, "sub");
		await mkdir(sub);
		await expect(setUpGit({ path: sub })).rejects.toThrow("inside the project");
	});
});

describe("systemGitInstaller", () => {
	const which =
		(...found: string[]) =>
		(name: string) =>
			found.includes(name) ? `/bin/${name}` : null;

	test("macOS opens Apple's installer", async () => {
		const ran: string[][] = [];
		const installer = systemGitInstaller({
			platform: "darwin",
			which: which("xcode-select"),
			run: async (argv) => {
				ran.push(argv);
				return { exitCode: 0, stderr: "" };
			},
		});
		expect(await installer.install()).toEqual({ kind: "started" });
		expect(ran).toEqual([["xcode-select", "--install"]]);
	});

	test("macOS falls back to brew when the installer does not start", async () => {
		const installer = systemGitInstaller({
			platform: "darwin",
			which: which("xcode-select", "brew"),
			run: async () => ({ exitCode: 1, stderr: "already installed" }),
		});
		expect(await installer.install()).toEqual({
			kind: "command",
			command: "brew install git",
		});
	});

	test("Linux returns the command and never runs it", async () => {
		const installer = systemGitInstaller({
			platform: "linux",
			which: which("dnf"),
			run: async () => {
				throw new Error("must not run");
			},
		});
		expect(await installer.install()).toEqual({
			kind: "command",
			command: "sudo dnf install git",
		});
	});

	test("Windows uses winget, else the download page", async () => {
		const run = async () => ({ exitCode: 0, stderr: "" });
		expect(
			await systemGitInstaller({
				platform: "win32",
				which: which("winget"),
				run,
			}).install(),
		).toEqual({
			kind: "command",
			command: "winget install --id Git.Git -e --source winget",
		});
		expect(
			await systemGitInstaller({
				platform: "win32",
				which: which(),
				run,
			}).install(),
		).toEqual({ kind: "manual", url: GIT_DOWNLOAD_URL });
	});
});
