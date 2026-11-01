import { Refusal } from "@nightshift/refusal";
import { now as timeNow } from "@nightshift/time";
import { type Git, systemGit } from "./git";
import { parseGitHubRepo } from "./github";
import type { GitHubClones } from "./github-clone";
import { PROJECT_NOT_FOUND, type Project } from "./projects";
import { normaliseRemote } from "./remote";

/**
 * Copies projects to this computer from GitHub. A Host copies every
 * project of its Spaces that has a GitHub remote and no Clone here
 * (`sweep`), so its schedules and chats can use the project without a
 * person adding a folder there. A person can copy one project here too
 * (`copy`). A copy is a clone in Night Shift's projects folder
 * (`GitHubClones`), added as a Clone of the project: its `origin` is the
 * project's remote. A copy that fails is tried again by the sweep, each
 * time after a longer wait. A person's `copy` tries at once.
 */

/** A copy to this computer that runs or failed. A copy that is done is a Clone. */
export type ProjectCopy = {
	projectId: string;
	state: "copying" | "failed";
	/** What went wrong, and how to fix it. Null while it copies. */
	problem: string | null;
};

/** The projects of one Space, as a copy needs them (`SpaceEngine`). */
export type CopySpace = {
	listProjects(): Promise<Project[]>;
	addProject(input: { repoPath: string }): Promise<Project>;
};

export type ProjectCopies = {
	/**
	 * Copies the project to this computer now, also after a failed try.
	 * Resolves when it is done (null) or failed (the copy).
	 */
	copy(space: CopySpace, projectId: string): Promise<ProjectCopy | null>;
	/** The copies to this computer that run or failed. */
	list(): ProjectCopy[];
	/** When `enabled`: copies each project of each Space that has no Clone here. */
	sweep(): Promise<void>;
	/** Sweeps now, then every `intervalMs`. */
	start(): void;
	stop(): void;
};

export const NOT_ON_GITHUB =
	"Night Shift can copy a project from GitHub only. Add its folder on this computer instead.";

export const NO_REMOTE =
	"This project has no remote repository. Add its folder on this computer instead.";

/** How often a Host looks for projects it has no Clone of. */
export const SWEEP_INTERVAL_MS = 60_000;

/** The wait after the first failed try. It doubles after each one. */
const FIRST_RETRY_MS = 5 * 60_000;
const MAX_RETRY_MS = 6 * 60 * 60_000;

export function createProjectCopies(deps: {
	gitHub: Pick<GitHubClones, "copy">;
	/** The Spaces of this computer. */
	spaceIds: () => Promise<string[]>;
	space: (spaceId: string) => CopySpace;
	/** Whether the sweep copies: a Host with "Copy every project" on. */
	enabled: () => boolean;
	git?: Git;
	intervalMs?: number;
	now?: () => number;
}): ProjectCopies {
	const git = deps.git ?? systemGit();
	const now = deps.now ?? timeNow;
	const copying = new Map<string, Promise<ProjectCopy | null>>();
	const failed = new Map<
		string,
		{ problem: string; tries: number; retryAt: number }
	>();
	let timer: ReturnType<typeof setInterval> | null = null;
	let sweeping: Promise<void> | null = null;

	function fail(projectId: string, problem: string): ProjectCopy {
		const tries = (failed.get(projectId)?.tries ?? 0) + 1;
		const wait = Math.min(FIRST_RETRY_MS * 2 ** (tries - 1), MAX_RETRY_MS);
		failed.set(projectId, { problem, tries, retryAt: now() + wait });
		return { projectId, state: "failed", problem };
	}

	/**
	 * Makes the clone's `origin` name the repository as the project does.
	 * GitHub names a repository in its own case (`Acme/App`), a person's
	 * clone may not (`acme/app`): the Clone must match the project's remote.
	 */
	async function matchOrigin(path: string, remote: string): Promise<boolean> {
		const origin = await git.run(path, ["remote", "get-url", "origin"]);
		if (origin.exitCode !== 0) return false;
		const url = origin.stdout.trim();
		const found = normaliseRemote(url);
		if (found === remote) return true;
		if (found?.toLowerCase() !== remote.toLowerCase()) return false;
		const foundPath = found.slice(found.indexOf("/") + 1);
		const at = url.toLowerCase().lastIndexOf(foundPath.toLowerCase());
		if (at === -1) return false;
		const wanted = remote.slice(remote.indexOf("/") + 1);
		const fixed = url.slice(0, at) + wanted + url.slice(at + foundPath.length);
		const set = await git.run(path, ["remote", "set-url", "origin", fixed]);
		return set.exitCode === 0;
	}

	async function copyProject(
		space: CopySpace,
		project: Project,
	): Promise<ProjectCopy | null> {
		const remote = project.remote;
		if (remote === null) return fail(project.id, NO_REMOTE);
		if (parseGitHubRepo(remote) === null)
			return fail(project.id, NOT_ON_GITHUB);
		const end = await deps.gitHub.copy(remote);
		if (end.state === "failed") return fail(project.id, end.problem);
		if (end.state === "cloning") {
			return fail(
				project.id,
				`Night Shift could not copy ${project.name}. Try again.`,
			);
		}
		if (!(await matchOrigin(end.path, remote))) {
			return fail(
				project.id,
				`The folder ${end.path} holds another repository. Move it away, then try again.`,
			);
		}
		await space.addProject({ repoPath: end.path });
		failed.delete(project.id);
		return null;
	}

	/** Copies the project, or joins its copy that runs. */
	function begin(space: CopySpace, project: Project) {
		const running = copying.get(project.id);
		if (running) return running;
		const copy = copyProject(space, project)
			.catch((error) =>
				fail(
					project.id,
					error instanceof Refusal
						? error.message
						: `Night Shift could not copy ${project.name}. Try again.`,
				),
			)
			.then((end) => {
				if (end) {
					console.warn(
						`[projects] copy of ${project.name} failed: ${end.problem}`,
					);
				}
				return end;
			})
			.finally(() => copying.delete(project.id));
		copying.set(project.id, copy);
		return copy;
	}

	async function sweepOnce() {
		for (const spaceId of await deps.spaceIds()) {
			if (!deps.enabled()) return;
			const space = deps.space(spaceId);
			for (const project of await space.listProjects()) {
				// A project without a remote is only on the computer that has its folder.
				if (project.repoPath !== null || project.remote === null) continue;
				const failure = failed.get(project.id);
				if (failure && failure.retryAt > now()) continue;
				// One at a time: a Host may have many projects to copy.
				await begin(space, project);
			}
		}
	}

	const copies: ProjectCopies = {
		async copy(space, projectId) {
			const project = (await space.listProjects()).find(
				(p) => p.id === projectId,
			);
			if (!project) throw new Refusal("not-found", PROJECT_NOT_FOUND);
			if (project.repoPath !== null) return null;
			return begin(space, project);
		},

		list() {
			const out: ProjectCopy[] = [...copying.keys()].map((projectId) => ({
				projectId,
				state: "copying",
				problem: null,
			}));
			for (const [projectId, failure] of failed) {
				if (copying.has(projectId)) continue;
				out.push({ projectId, state: "failed", problem: failure.problem });
			}
			return out;
		},

		sweep() {
			if (!deps.enabled()) return Promise.resolve();
			sweeping ??= sweepOnce()
				.catch((error) => {
					console.warn(
						"[projects] the sweep for projects to copy failed:",
						error,
					);
				})
				.finally(() => {
					sweeping = null;
				});
			return sweeping;
		},

		start() {
			copies.stop();
			void copies.sweep();
			timer = setInterval(
				() => void copies.sweep(),
				deps.intervalMs ?? SWEEP_INTERVAL_MS,
			);
		},

		stop() {
			if (timer) clearInterval(timer);
			timer = null;
		},
	};
	return copies;
}
