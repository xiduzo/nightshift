/**
 * Clones from GitHub into a folder Night Shift manages:
 * `<data dir>/projects/<owner>/<repo>`, in lower case. A clone runs in the
 * background, so no request waits for it: `start` returns at once and
 * `status` says how it goes. A folder that already holds a clone of the
 * same repository is used again. The folder is then added like any other.
 */

/** How one clone from GitHub goes. `repo` is `owner/repo` as the person entered it. */
export type GitHubClone =
	| { state: "cloning"; repo: string }
	| { state: "done"; repo: string; path: string; reused: boolean }
	| { state: "failed"; repo: string; problem: string };

/**
 * What the clones that run keep across a `bun --hot` reload: the daemon
 * keeps this object, and each new adapter goes on with it.
 */
export type CloneTracker = {
	/** How each clone goes, by its key. */
	states: Map<string, GitHubClone>;
	/** The clones that run, until they end. */
	ends: Map<string, Promise<GitHubClone>>;
	/** The starts that look at the folder now. */
	starting: Map<string, Promise<GitHubClone>>;
};

export function createCloneTracker(): CloneTracker {
	return { states: new Map(), ends: new Map(), starting: new Map() };
}

/** How long one clone may take before Night Shift stops it. */
export const CLONE_TIMEOUT_MS = 15 * 60_000;

export const NOT_A_GITHUB_REPO =
	"Enter a GitHub repository, for example acme/app or https://github.com/acme/app.";

/** A clone that failed for no reason Night Shift knows. */
export function couldNotClone(label: string): string {
	return `Night Shift could not copy ${label} from GitHub. Try again.`;
}

/** The folder of a clone holds other files. */
export function folderTaken(path: string): string {
	return `The folder ${path} already holds other files. Move them away, then try again.`;
}

/** What went wrong with a clone, and how to fix it. */
export function cloneProblem(
	result: { timedOut?: boolean; stderr: string },
	label: string,
	signedIn: boolean,
	timeoutMs: number,
): string {
	if (result.timedOut) {
		return `Copying ${label} took longer than ${Math.round(timeoutMs / 60_000)} minutes, so Night Shift stopped. Try again later.`;
	}
	const said = result.stderr.toLowerCase();
	if (
		/could not resolve host|unable to access|network is unreachable|connection timed out|failed to connect/.test(
			said,
		)
	) {
		return "Night Shift cannot reach GitHub. Check the internet connection of this computer, then try again.";
	}
	if (/not found|could not resolve to a repository|does not exist/.test(said)) {
		return signedIn
			? `GitHub has no repository ${label} that you can open. Check the name and your access.`
			: `GitHub has no public repository ${label}. Check the name. For a private repository, run gh auth login on this computer.`;
	}
	if (
		/could not read username|authentication failed|terminal prompts disabled|permission denied|403/.test(
			said,
		)
	) {
		return signedIn
			? `GitHub refused access to ${label}. Check your access to it.`
			: `GitHub refused access to ${label}. To sign in to GitHub, run gh auth login on this computer.`;
	}
	return couldNotClone(label);
}
