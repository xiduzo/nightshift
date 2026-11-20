import { Refusal } from "@nightshift/refusal";

/**
 * Copies projects to this computer from GitHub. A Host copies every
 * project of its Spaces that has a folder, a GitHub remote and no Clone
 * here (the sweep), so its schedules and chats can use the project without
 * a person adding a folder there. A person can copy one project here too.
 * A copy is a clone in Night Shift's projects folder, added as a Clone of
 * the project: its `origin` is the project's remote. A copy that fails is
 * tried again by the sweep, each time after a longer wait. A person's copy
 * tries at once.
 */

/** A copy to this computer that runs or failed. A copy that is done is a Clone. */
export type ProjectCopy = {
	projectId: string;
	state: "copying" | "failed";
	/** What went wrong, and how to fix it. Null while it copies. */
	problem: string | null;
};

/** A project as a copy reads it. */
export type CopyProject = {
	id: string;
	name: string;
	repoPath: string | null;
	remote: string | null;
	folder: boolean;
};

/** The projects of one Space, as a copy needs them (`SpaceEngine`). */
export type CopySpace = {
	listProjects(): Promise<CopyProject[]>;
	addProject(input: { repoPath: string }): Promise<unknown>;
};

export const NOT_ON_GITHUB =
	"Night Shift can copy a project from GitHub only. Add its folder on this computer instead.";

export const NO_REMOTE =
	"This project has no remote repository. Add its folder on this computer instead.";

/** A project without a folder (ADR 22): its runs need no copy. */
export const NOTHING_TO_COPY =
	"This project has no folder, so there is nothing to copy to this computer.";

/** A copy that failed for no reason Night Shift knows. */
export function couldNotCopy(name: string): string {
	return `Night Shift could not copy ${name}. Try again.`;
}

/** The folder of a copy holds another repository. */
export function holdsAnother(path: string): string {
	return `The folder ${path} holds another repository. Move it away, then try again.`;
}

/** How often a Host looks for projects it has no Clone of. */
export const SWEEP_INTERVAL_MS = 60_000;

/** The wait after the first failed try. It doubles after each one. */
const FIRST_RETRY_MS = 5 * 60_000;
const MAX_RETRY_MS = 6 * 60 * 60_000;

/** The copies that run and the ones that failed: one object for the life of the copies. */
export type CopyState = {
	copying: Map<string, Promise<ProjectCopy | null>>;
	failed: Map<string, { problem: string; tries: number; retryAt: number }>;
	/** The sweep that runs: a second one joins it. */
	sweeping: Promise<void> | null;
};

export function createCopyState(): CopyState {
	return { copying: new Map(), failed: new Map(), sweeping: null };
}

/** A failed try: the next one waits longer. */
export function failCopy(
	state: CopyState,
	projectId: string,
	problem: string,
	now: number,
): ProjectCopy {
	const tries = (state.failed.get(projectId)?.tries ?? 0) + 1;
	const wait = Math.min(FIRST_RETRY_MS * 2 ** (tries - 1), MAX_RETRY_MS);
	state.failed.set(projectId, { problem, tries, retryAt: now + wait });
	return { projectId, state: "failed", problem };
}

/** The copies that run, then the ones that failed. */
export function copiesOf(state: CopyState): ProjectCopy[] {
	const out: ProjectCopy[] = [...state.copying.keys()].map((projectId) => ({
		projectId,
		state: "copying",
		problem: null,
	}));
	for (const [projectId, failure] of state.failed) {
		if (state.copying.has(projectId)) continue;
		out.push({ projectId, state: "failed", problem: failure.problem });
	}
	return out;
}

/** What the sweep copies: a project with a folder and a remote, and no Clone here. */
export function wantsCopy(project: CopyProject): boolean {
	return project.folder && project.repoPath === null && project.remote !== null;
}

/** What a copy takes: the clone, its origin, and the add of the folder. */
export type CopySteps = {
	isGitHub(remote: string): boolean;
	clone(
		remote: string,
	): Promise<
		| { state: "cloning" }
		| { state: "done"; path: string }
		| { state: "failed"; problem: string }
	>;
	matchOrigin(path: string, remote: string): Promise<boolean>;
	/** The folder became a Clone of the project. */
	added(): void;
	now(): number;
};

async function copyProject(
	steps: CopySteps,
	state: CopyState,
	space: CopySpace,
	project: CopyProject,
): Promise<ProjectCopy | null> {
	const fail = (problem: string) =>
		failCopy(state, project.id, problem, steps.now());
	const remote = project.remote;
	if (remote === null) return fail(NO_REMOTE);
	if (!steps.isGitHub(remote)) return fail(NOT_ON_GITHUB);
	const end = await steps.clone(remote);
	if (end.state === "failed") return fail(end.problem);
	if (end.state === "cloning") return fail(couldNotCopy(project.name));
	if (!(await steps.matchOrigin(end.path, remote))) {
		return fail(holdsAnother(end.path));
	}
	await space.addProject({ repoPath: end.path });
	steps.added();
	state.failed.delete(project.id);
	return null;
}

/** Copies the project, or joins its copy that runs. */
export function beginCopy(
	steps: CopySteps,
	state: CopyState,
	space: CopySpace,
	project: CopyProject,
): Promise<ProjectCopy | null> {
	const running = state.copying.get(project.id);
	if (running) return running;
	const copy = copyProject(steps, state, space, project)
		.catch((error) =>
			failCopy(
				state,
				project.id,
				error instanceof Refusal ? error.message : couldNotCopy(project.name),
				steps.now(),
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
		.finally(() => state.copying.delete(project.id));
	state.copying.set(project.id, copy);
	return copy;
}
