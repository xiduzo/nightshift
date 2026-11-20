import { KNOWLEDGE_SOURCE_KINDS } from "@nightshift/flows";

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
	platform: string;
};

export const NO_GIT = "Git is not installed on this computer.";
export const NO_SUCH_FOLDER = "This folder does not exist.";
export const NOT_A_REPOSITORY = "This folder does not use git yet.";
export const NO_COMMIT =
	"The project has no commits yet. Each run starts from a commit.";
export const NO_IDENTITY =
	"Git needs your name and email for the first commit.";

/** A subfolder of a repository: its top folder is the project. */
export function insideProject(topLevel: string): string {
	return `This folder is inside the project at ${topLevel}. Add that folder instead.`;
}

/** Written only when the folder has no `.gitignore`. */
export const STARTER_GITIGNORE = `.DS_Store
node_modules/
.env
.env.local
.env.*.local
`;

/** The package managers that install programs, by platform: the first found wins. */
const TOOL_INSTALLERS: Partial<
	Record<string, { program: string; command: (names: string[]) => string }[]>
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

export const ok = (id: ReadinessStepId): ReadinessStep => ({
	id,
	status: "ok",
	problem: null,
	fix: null,
});
export const skipped = (id: ReadinessStepId): ReadinessStep => ({
	id,
	status: "skipped",
	problem: null,
	fix: null,
});
export const failed = (
	id: ReadinessStepId,
	problem: string,
	fix: ReadinessFix | null,
): ReadinessStep => ({ id, status: "failed", problem, fix });

/**
 * The `tools` step: the programs the built-in knowledge sources run that
 * this computer misses, the sources that need them, and how to install
 * them.
 */
export function checkTools(deps: ToolsDeps): {
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

/** The readiness of the folder from its steps, with the `tools` step last. */
export function readinessOf(
	path: string,
	steps: ReadinessStep[],
	topLevel: string | null,
	tools: { step: ReadinessStep; install: ToolsInstall | null },
): ProjectReadiness {
	return {
		path,
		// Runs start without the programs of the knowledge sources.
		ready: steps.every((step) => step.status === "ok"),
		topLevel,
		needsIdentity: steps.some(
			(step) => step.id === "identity" && step.status === "failed",
		),
		steps: [...steps, tools.step],
		toolsInstall: tools.install,
	};
}

/** The failed step a `set-up-git` cannot fix, or none. */
export function setUpBlocker(
	readiness: ProjectReadiness,
): ReadinessStep | undefined {
	return readiness.steps.find(
		(step) =>
			step.status === "failed" &&
			step.fix !== "set-up-git" &&
			step.id !== "tools",
	);
}
