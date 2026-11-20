import { now as timeNow } from "@nightshift/time";
import { type Actor, NIGHT_SHIFT } from "../../contract";
import type { Git } from "../../git";
import { type GitHubCli, parseGitHubRepo } from "../../github";
import type { UsageNotes } from "../../usage";
import { createCopySweep } from "./adapters/in/copy-sweep";
import { gitCloneOrigins } from "./adapters/out/git-clone-origins";
import { nodeGitHubClones } from "./adapters/out/node-git-hub-clones";
import { copyProjectHere } from "./application/copy-project-here";
import { listGitHubRepos } from "./application/list-git-hub-repos";
import { listProjectCopies } from "./application/list-project-copies";
import type { GitHubClones } from "./application/ports";
import { readGitHubAccess } from "./application/read-git-hub-access";
import { readGitHubClone } from "./application/read-git-hub-clone";
import { startGitHubClone } from "./application/start-git-hub-clone";
import { sweepProjectCopies } from "./application/sweep-project-copies";
import type { CloneTracker } from "./domain/clones";
import {
	type CopySpace,
	createCopyState,
	type ProjectCopy,
	SWEEP_INTERVAL_MS,
} from "./domain/copies";

/**
 * The wiring of the copies: the one place that builds their real adapters
 * (the clones from GitHub, the origin of a clone) and their state, and
 * binds each use case to its ports. The daemon calls it on each reload,
 * with the clone tracker it keeps.
 */

/** What the daemon gives the copies. */
export type CopiesDeps = {
	dataDir: string;
	/** The clones that run, kept across a `bun --hot` reload. */
	tracker: CloneTracker;
	/** The git port. Default: the git programs on this computer. */
	git?: Git;
	/** The GitHub port. Default: `gh` on this computer. */
	gh?: GitHubCli;
	timeoutMs?: number;
	/** The Spaces of this computer. */
	spaceIds: () => Promise<string[]>;
	/** One Space, as an actor sees it: the sweep acts as Night Shift. */
	space: (spaceId: string, actor: Actor) => CopySpace;
	/** Whether the sweep copies: a Host with "Copy every project" on. */
	enabled: () => boolean;
	intervalMs?: number;
	now?: () => number;
	/** Anonymous usage, when this computer records it. */
	usage?: UsageNotes;
};

/** The copies of projects to this computer, as the setup routes call them. */
export type ProjectCopies = {
	/**
	 * Copies the project to this computer now, also after a failed try.
	 * Resolves when it is done (null) or failed (the copy). Refuses a
	 * project without a folder.
	 */
	copy(space: CopySpace, projectId: string): Promise<ProjectCopy | null>;
	/** The copies to this computer that run or failed. */
	list(): ProjectCopy[];
	/** When enabled: copies each project of each Space that has a folder and no Clone here. */
	sweep(): Promise<void>;
	/** Sweeps now, then every interval. */
	start(): void;
	stop(): void;
};

export type Copies = { gitHub: GitHubClones; copies: ProjectCopies };

export function wireCopies(deps: CopiesDeps): Copies {
	const clones = nodeGitHubClones({
		dataDir: deps.dataDir,
		tracker: deps.tracker,
		...(deps.git ? { git: deps.git } : {}),
		...(deps.gh ? { gh: deps.gh } : {}),
		...(deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {}),
	});
	const now = deps.now ?? timeNow;
	const ports = {
		gitHub: clones,
		origins: gitCloneOrigins(deps.git),
		ground: {
			now,
			isGitHub: (remote: string) => parseGitHubRepo(remote) !== null,
			added: () =>
				deps.usage?.note({
					kind: "project-added",
					source: "github",
					hasRemote: true,
					starters: 0,
				}),
		},
		spaces: {
			spaceIds: deps.spaceIds,
			space: (spaceId: string) => deps.space(spaceId, NIGHT_SHIFT),
			enabled: deps.enabled,
		},
		state: createCopyState(),
	};
	const copy = copyProjectHere(ports);
	const list = listProjectCopies(ports);
	const sweep = sweepProjectCopies(ports);
	const timer = createCopySweep({
		sweep,
		intervalMs: deps.intervalMs ?? SWEEP_INTERVAL_MS,
	});
	const start = startGitHubClone(ports);
	const status = readGitHubClone(ports);
	const access = readGitHubAccess(ports);
	const repos = listGitHubRepos(ports);
	return {
		gitHub: {
			access: () => access(),
			repos: () => repos(),
			start: (repo) => start({ repo }),
			status: (repo) => status({ repo }),
			copy: (repo) => clones.copy(repo),
		},
		copies: {
			copy: (space, projectId) => copy({ space, projectId }),
			list: () => list(),
			sweep: () => sweep(),
			start: () => timer.start(),
			stop: () => timer.stop(),
		},
	};
}
