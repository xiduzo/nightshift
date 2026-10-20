/**
 * The git port. Every `git` and `xcode-select` process the engine starts
 * goes through a `Git`: run worktrees, the git setup of a project folder,
 * a project's remote and the branches of a clone. `systemGit()` is the
 * adapter over the programs on this computer (`Bun.spawn`). A test passes
 * its own `Git` where it does not want a real git.
 */

/** What one git command gave back. The output is trimmed. */
export type GitResult = { exitCode: number; stdout: string; stderr: string };

/**
 * What starting the git installer did.
 * - `started`: the system's installer window is open (macOS).
 * - `command`: run this in a terminal. Night Shift never runs `sudo`.
 * - `manual`: no installer found; the download page.
 */
export type GitInstall =
	| { kind: "started" }
	| { kind: "command"; command: string }
	| { kind: "manual"; url: string };

export type Git = {
	/**
	 * Runs git in `cwd`. Throws `GitNotInstalledError` when git cannot
	 * start, so that a missing git does not read as "not a repository".
	 */
	run(cwd: string, args: string[]): Promise<GitResult>;
	/** The git version, or null when git is not on this computer. */
	probe(): Promise<string | null>;
	/** The `install-git` fix. Never installs anything without the system's own prompt. */
	install(): Promise<GitInstall>;
};

/** The `install-git` fix alone (`Git.install`). */
export type GitInstaller = Pick<Git, "install">;

export class GitError extends Error {
	constructor(
		message: string,
		readonly stderr: string,
	) {
		super(message);
		this.name = "GitError";
	}
}

/** Git is not on this computer: the `git` program cannot start. */
export class GitNotInstalledError extends Error {
	constructor() {
		super(
			"Git is not installed on this computer. Install git, then try again.",
		);
		this.name = "GitNotInstalledError";
	}
}

/** Runs git in `cwd` and returns its output. Throws `GitError` when git fails. */
export async function gitOrThrow(
	git: Git,
	cwd: string,
	args: string[],
): Promise<string> {
	const result = await git.run(cwd, args);
	if (result.exitCode !== 0) {
		throw new GitError(
			`git ${args.join(" ")} failed: ${result.stderr || `exit code ${result.exitCode}`}`,
			result.stderr,
		);
	}
	return result.stdout;
}

/** Variables a git hook sets that would point git at the wrong repository. */
const leakingGitVariables = [
	"GIT_DIR",
	"GIT_WORK_TREE",
	"GIT_INDEX_FILE",
	"GIT_PREFIX",
	"GIT_COMMON_DIR",
	"GIT_OBJECT_DIRECTORY",
	"GIT_ALTERNATE_OBJECT_DIRECTORIES",
];

function gitEnv(): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value === undefined || leakingGitVariables.includes(key)) continue;
		env[key] = value;
	}
	return env;
}

async function runGit(cwd: string, args: string[]): Promise<GitResult> {
	if (Bun.which("git") === null) throw new GitNotInstalledError();
	const proc = Bun.spawn(["git", ...args], {
		cwd,
		env: gitEnv(),
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() };
}

/**
 * Finds git without starting Apple's installer by accident: on macOS,
 * `/usr/bin/git` is a stub that opens the install dialog when the command
 * line tools are missing, so ask `xcode-select -p` first.
 */
async function probeGit(): Promise<string | null> {
	const path = Bun.which("git");
	if (path === null) return null;
	if (process.platform === "darwin" && path === "/usr/bin/git") {
		const tools = Bun.spawnSync(["xcode-select", "-p"], {
			stdout: "ignore",
			stderr: "ignore",
		});
		if (tools.exitCode !== 0) return null;
	}
	const version = await runGit(process.cwd(), ["--version"]).catch(() => null);
	return version?.exitCode === 0 ? version.stdout : null;
}

export const GIT_DOWNLOAD_URL = "https://git-scm.com/downloads";

type InstallerDeps = {
	platform: NodeJS.Platform;
	which: (name: string) => string | null;
	/** Runs a program and resolves with its exit code and error output. */
	run: (argv: string[]) => Promise<{ exitCode: number; stderr: string }>;
};

async function runProgram(
	argv: string[],
): Promise<{ exitCode: number; stderr: string }> {
	const proc = Bun.spawn(argv, {
		stdin: "ignore",
		stdout: "ignore",
		stderr: "pipe",
	});
	const [stderr, exitCode] = await Promise.all([
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { exitCode, stderr: stderr.trim() };
}

/** Package managers by platform, first found wins. */
const INSTALL_COMMANDS: Partial<
	Record<NodeJS.Platform, { program: string; command: string }[]>
> = {
	darwin: [{ program: "brew", command: "brew install git" }],
	linux: [
		{ program: "apt-get", command: "sudo apt-get install git" },
		{ program: "dnf", command: "sudo dnf install git" },
		{ program: "pacman", command: "sudo pacman -S git" },
		{ program: "zypper", command: "sudo zypper install git" },
		{ program: "brew", command: "brew install git" },
	],
	win32: [
		{
			program: "winget",
			command: "winget install --id Git.Git -e --source winget",
		},
	],
};

/** The system's git installer: Apple's dialog on macOS, else a package manager's command. */
export function systemGitInstaller(
	deps: InstallerDeps = {
		platform: process.platform,
		which: (name) => Bun.which(name),
		run: runProgram,
	},
): GitInstaller {
	const command = (): GitInstall => {
		const found = (INSTALL_COMMANDS[deps.platform] ?? []).find(
			(entry) => deps.which(entry.program) !== null,
		);
		return found
			? { kind: "command", command: found.command }
			: { kind: "manual", url: GIT_DOWNLOAD_URL };
	};
	return {
		async install() {
			if (deps.platform === "darwin" && deps.which("xcode-select") !== null) {
				// Opens Apple's dialog for the command line tools, which hold git.
				const result = await deps.run(["xcode-select", "--install"]);
				if (result.exitCode === 0) return { kind: "started" };
			}
			return command();
		},
	};
}

/** The git programs on this computer. */
export function systemGit(): Git {
	return {
		run: runGit,
		probe: probeGit,
		install: () => systemGitInstaller().install(),
	};
}
