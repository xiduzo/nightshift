import { realpath, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { KNOWLEDGE_SOURCE_KINDS } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";

import { type Git, gitOrThrow, systemGit } from "./git";

/**
 * Project readiness: what a folder needs before runs can start in it, in
 * order: git on this computer, the folder at the top of a git repository, a
 * first commit (each run's worktree starts from one), and a name and email
 * for git when Night Shift must make that commit. Each failed step names the
 * fix the UI offers. A fix runs only when a person asks for it.
 *
 * Then the programs the built-in knowledge sources run (`tools`: jq and
 * curl), with the command that installs them. Runs start without them:
 * that step never makes a folder not ready.
 */

export type ReadinessStepId =
	| "git"
	| "folder"
	| "commit"
	| "identity"
	| "tools";
export type ReadinessStatus = "ok" | "failed" | "skipped";
/**
 * - `install-git`: start the system's git installer (`Git.install`).
 * - `use-top-folder`: add `topLevel` instead of the chosen subfolder.
 * - `set-up-git`: `setUpGit`, with a name and email when `needsIdentity`.
 * - `install-tools`: the person runs `toolsInstall` themselves.
 */
export type ReadinessFix =
	| "install-git"
	| "use-top-folder"
	| "set-up-git"
	| "install-tools";

/** How a person installs missing programs: a command to run in a terminal, or a download page. */
export type ToolsInstall =
	| { kind: "command"; command: string }
	| { kind: "manual"; url: string };

export type ReadinessStep = {
	id: ReadinessStepId;
	status: ReadinessStatus;
	/** What is wrong, for the person. Null unless the step failed. */
	problem: string | null;
	fix: ReadinessFix | null;
};

export type ProjectReadiness = {
	/** The folder as given. */
	path: string;
	/** Runs can start: git, the folder and the first commit are in place. */
	ready: boolean;
	/** The top folder of the repository, when the folder is in one. */
	topLevel: string | null;
	/** `set-up-git` needs a name and email: git has none for this folder. */
	needsIdentity: boolean;
	/** The identity step is there only when a first commit is needed. */
	steps: ReadinessStep[];
	/** How to install the programs the `tools` step misses. Null: none is missing. */
	toolsInstall: ToolsInstall | null;
};

/** Where the readiness check looks for programs, and on which system. */
export type ToolsDeps = {
	which(name: string): string | null;
	platform: NodeJS.Platform;
};

const systemTools: ToolsDeps = {
	which: (name) => Bun.which(name),
	platform: process.platform,
};

/** The package managers that install programs, by platform: the first found wins. */
const TOOL_INSTALLERS: Partial<
	Record<
		NodeJS.Platform,
		{ program: string; command: (names: string[]) => string }[]
	>
> = {
	darwin: [{ program: "brew", command: (n) => `brew install ${n.join(" ")}` }],
	linux: [
		{
			program: "apt-get",
			command: (n) => `sudo apt-get install ${n.join(" ")}`,
		},
		{ program: "dnf", command: (n) => `sudo dnf install ${n.join(" ")}` },
		{ program: "apk", command: (n) => `sudo apk add ${n.join(" ")}` },
		{ program: "pacman", command: (n) => `sudo pacman -S ${n.join(" ")}` },
		{ program: "zypper", command: (n) => `sudo zypper install ${n.join(" ")}` },
		{ program: "brew", command: (n) => `brew install ${n.join(" ")}` },
	],
	win32: [
		{
			program: "winget",
			command: (n) =>
				n
					.map((name) => `winget install --id ${WINGET_IDS[name] ?? name} -e`)
					.join(" && "),
		},
	],
};
const WINGET_IDS: Record<string, string> = {
	jq: "jqlang.jq",
	curl: "cURL.cURL",
};
/** Each program's own download page, when no package manager is found. */
const DOWNLOADS: Record<string, string> = {
	jq: "https://jqlang.org/download/",
	curl: "https://curl.se/download.html",
};

/** "A", "A and B", "A, B and C". */
function listed(names: readonly string[]): string {
	if (names.length <= 1) return names.join("");
	return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * The `tools` step: the programs the built-in knowledge sources run that
 * this computer misses, the sources that need them, and how to install
 * them.
 */
export function checkTools(deps: ToolsDeps = systemTools): {
	step: ReadinessStep;
	install: ToolsInstall | null;
} {
	const missing = [
		...new Set(KNOWLEDGE_SOURCE_KINDS.flatMap((kind) => kind.programs)),
	]
		.filter((name) => deps.which(name) === null)
		.sort();
	if (missing.length === 0) return { step: ok("tools"), install: null };
	const sources = KNOWLEDGE_SOURCE_KINDS.filter((kind) =>
		kind.programs.some((name) => missing.includes(name)),
	).map((kind) => kind.label);
	const one = missing.length === 1;
	const problem = `${listed(missing)} ${one ? "is" : "are"} not on this computer. ${listed(sources)} sources need ${one ? "it" : "them"}.`;
	const installer = (TOOL_INSTALLERS[deps.platform] ?? []).find(
		(entry) => deps.which(entry.program) !== null,
	);
	const install: ToolsInstall = installer
		? { kind: "command", command: installer.command(missing) }
		: { kind: "manual", url: DOWNLOADS[missing[0] as string] as string };
	return { step: failed("tools", problem, "install-tools"), install };
}

const ok = (id: ReadinessStepId): ReadinessStep => ({
	id,
	status: "ok",
	problem: null,
	fix: null,
});
const skipped = (id: ReadinessStepId): ReadinessStep => ({
	id,
	status: "skipped",
	problem: null,
	fix: null,
});
const failed = (
	id: ReadinessStepId,
	problem: string,
	fix: ReadinessFix | null,
): ReadinessStep => ({ id, status: "failed", problem, fix });

async function isDirectory(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isDirectory();
	} catch {
		return false;
	}
}

/** The repository's top folder, or null when `dir` is not in a repository. */
async function topLevelOf(git: Git, dir: string): Promise<string | null> {
	const result = await git.run(dir, ["rev-parse", "--show-toplevel"]);
	if (result.exitCode !== 0 || !result.stdout) return null;
	return realpath(result.stdout);
}

async function hasCommit(git: Git, dir: string): Promise<boolean> {
	const result = await git.run(dir, [
		"rev-parse",
		"--verify",
		"--quiet",
		"HEAD^{commit}",
	]);
	return result.exitCode === 0;
}

async function configValue(
	git: Git,
	dir: string,
	key: string,
): Promise<string | null> {
	const result = await git.run(dir, ["config", "--get", key]);
	return result.exitCode === 0 && result.stdout ? result.stdout : null;
}

async function hasIdentity(git: Git, dir: string): Promise<boolean> {
	const [name, email] = await Promise.all([
		configValue(git, dir, "user.name"),
		configValue(git, dir, "user.email"),
	]);
	return name !== null && email !== null;
}

const NO_COMMIT =
	"The project has no commits yet. Each run starts from a commit.";
const NO_IDENTITY = "Git needs your name and email for the first commit.";

export async function checkProjectFolder(
	path: string,
	options: { git?: Git; tools?: ToolsDeps } = {},
): Promise<ProjectReadiness> {
	const tools = checkTools(options.tools);
	const result = (
		steps: ReadinessStep[],
		topLevel: string | null = null,
	): ProjectReadiness => ({
		path,
		// Runs start without the programs of the knowledge sources.
		ready: steps.every((step) => step.status === "ok"),
		topLevel,
		needsIdentity: steps.some(
			(step) => step.id === "identity" && step.status === "failed",
		),
		steps: [...steps, tools.step],
		toolsInstall: tools.install,
	});

	const git = options.git ?? systemGit();
	if ((await git.probe()) === null) {
		return result([
			failed("git", "Git is not installed on this computer.", "install-git"),
			skipped("folder"),
			skipped("commit"),
		]);
	}
	if (!(await isDirectory(path))) {
		return result([
			ok("git"),
			failed("folder", "This folder does not exist.", null),
			skipped("commit"),
		]);
	}
	const dir = await realpath(path);
	const topLevel = await topLevelOf(git, dir);
	if (topLevel === null) {
		return result([
			ok("git"),
			failed("folder", "This folder does not use git yet.", "set-up-git"),
			failed("commit", NO_COMMIT, "set-up-git"),
			(await hasIdentity(git, dir))
				? ok("identity")
				: failed("identity", NO_IDENTITY, "set-up-git"),
		]);
	}
	if (topLevel !== dir) {
		return result(
			[
				ok("git"),
				failed(
					"folder",
					`This folder is inside the project at ${topLevel}. Add that folder instead.`,
					"use-top-folder",
				),
				skipped("commit"),
			],
			topLevel,
		);
	}
	if (await hasCommit(git, dir)) {
		return result([ok("git"), ok("folder"), ok("commit")], topLevel);
	}
	return result(
		[
			ok("git"),
			ok("folder"),
			failed("commit", NO_COMMIT, "set-up-git"),
			(await hasIdentity(git, dir))
				? ok("identity")
				: failed("identity", NO_IDENTITY, "set-up-git"),
		],
		topLevel,
	);
}

/** Written only when the folder has no `.gitignore`. */
export const STARTER_GITIGNORE = `.DS_Store
node_modules/
.env
.env.local
.env.*.local
`;

/**
 * The `set-up-git` fix. Makes the folder a repository when it is not one,
 * sets a name and email in the repository's own config when given (never the
 * global config), writes a starter `.gitignore` when there is none, and makes
 * a first commit of every file when there is no commit. Returns the folder's
 * readiness after.
 */
export async function setUpGit(
	input: { path: string; name?: string; email?: string },
	options: { git?: Git } = {},
): Promise<ProjectReadiness> {
	const before = await checkProjectFolder(input.path, options);
	const blocker = before.steps.find(
		(step) =>
			step.status === "failed" &&
			step.fix !== "set-up-git" &&
			step.id !== "tools",
	);
	if (blocker) {
		throw new Refusal(
			"conflict",
			blocker.problem ?? "The folder is not ready.",
		);
	}
	if (before.ready) return before;

	const git = options.git ?? systemGit();
	const dir = await realpath(input.path);
	if (before.topLevel === null) await gitOrThrow(git, dir, ["init", "-q"]);
	const name = input.name?.trim();
	const email = input.email?.trim();
	if (name) await gitOrThrow(git, dir, ["config", "user.name", name]);
	if (email) await gitOrThrow(git, dir, ["config", "user.email", email]);
	if (!(await hasIdentity(git, dir))) throw new Refusal("invalid", NO_IDENTITY);

	const gitignore = join(dir, ".gitignore");
	if (!(await Bun.file(gitignore).exists())) {
		await writeFile(gitignore, STARTER_GITIGNORE);
	}
	if (!(await hasCommit(git, dir))) {
		await gitOrThrow(git, dir, ["add", "-A"]);
		await gitOrThrow(git, dir, [
			"commit",
			"-q",
			"--allow-empty",
			"-m",
			"Initial commit",
		]);
	}
	return checkProjectFolder(input.path, options);
}
