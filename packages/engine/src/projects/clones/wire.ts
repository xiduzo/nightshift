import type {
	CloneRecord,
	Keep,
	ListedProject,
	MovingProject,
	NewIds,
	ProjectDirectory,
	ProjectLog,
	ProjectRow,
	Repos,
	SpaceHolds,
	TakenProjects,
} from "../keep";
import { addProjectFromRemote } from "./application/add-project-from-remote";
import { checkProjectMove } from "./application/check-project-move";
import { defineProjectWithoutFolder } from "./application/define-project-without-folder";
import { findProject } from "./application/find-project";
import { findProjectSpace } from "./application/find-project-space";
import { listClonedHere } from "./application/list-cloned-here";
import { listClones } from "./application/list-clones";
import { listProjectsHere } from "./application/list-projects-here";
import type { KnownSpaces } from "./application/ports";
import { readRemotes } from "./application/read-remotes";
import { recordClone } from "./application/record-clone";
import { setClones } from "./application/set-clones";

/**
 * The wiring of what Night Shift, the other slices and the Host ask of
 * the Projects: it binds each use case to the shared ports (`keep`) and to
 * the ports other verticals fill, and hands them on as `Projects`, the
 * shape the engine's other slices take. It builds no adapter of its own.
 */

/** What the engine gives the clones. */
export type ClonesDeps = Keep & {
	projectLog: ProjectLog;
	repos: Repos;
	directory: ProjectDirectory;
	spaceHolds: SpaceHolds;
	ids: NewIds;
	knownSpaces: KnownSpaces;
};

/**
 * The Projects as the engine's other slices and the peers take them: each
 * member is one use case, or one call of a port that only forwards.
 */
export type Projects = {
	/** The projects with a Clone here a person has not removed: the Space's, or every Space's. */
	list(spaceId?: string): Promise<ProjectRow[]>;
	/** Every project a person has not removed, oldest first, also those without a Clone here: the Space's, or every Space's. */
	listInSpace(spaceId?: string): Promise<ListedProject[]>;
	/** A project a person has not removed, with its folder here or null. */
	find(projectId: string, spaceId?: string): Promise<ListedProject>;
	/**
	 * The projects of a Space, removed ones too, oldest first, with whether
	 * this computer has a Clone of each and walked a run of it in the Space:
	 * what a Device asks its home Host to take when its personal Space
	 * merges into the Host's, and what a split takes along.
	 */
	ofSpace(
		spaceId: string,
	): Promise<(MovingProject & { clone: boolean; walked: boolean })[]>;
	/** The projects of ids or remotes, in any Space, removed ones too. */
	matching(input: {
		ids?: readonly string[];
		remotes?: readonly string[];
	}): Promise<MovingProject[]>;
	/** The Devices with a Clone of the project, oldest Clone first. */
	clones(
		spaceId: string,
		projectId: string,
	): Promise<{ deviceId: string; deviceName: string | null }[]>;
	/** The folder of the project's Clone here, or null: none here, a project a person removed, or a project of another Space. */
	clonePath(projectId: string, spaceId: string): Promise<string | null>;
	/** Records another Device's Clone, on the Host that keeps the Space. */
	recordClone(spaceId: string, record: CloneRecord): Promise<void>;
	/** Makes a Device's Clones exactly the projects it has, on the Host that keeps the Space. */
	setClones(
		spaceId: string,
		input: {
			deviceId: string;
			deviceName: string;
			projectIds: readonly string[];
		},
	): Promise<{ added: string[]; removed: string[] }>;
	/** The projects of the Space with a Clone here, removed ones too. */
	clonedHere(spaceId: string): Promise<string[]>;
	/**
	 * Removes a Device's Clones and its name from the Space documents kept
	 * here. A Space a Host keeps elsewhere is that Host's to change.
	 */
	forgetDevice(deviceId: string): Promise<void>;
	/** The project of a remote in the Space, for a Device that asks its Host. */
	addFromRemote(
		spaceId: string,
		input: { name: string; remote: string },
	): Promise<{ projectId: string }>;
	/** A new project without a folder in a Space this Replica keeps. */
	defineWithoutFolder(
		spaceId: string,
		input: { name: string },
	): Promise<{ projectId: string }>;
	/**
	 * Takes projects into the Space's document, in one change: new entries,
	 * removed projects back, and a Device's Clones. A Space a Host keeps is
	 * left alone: only that Host changes it.
	 */
	take(spaceId: string, taken: TakenProjects): Promise<void>;
	/** Refuses a move of the project from `from` to `to`. */
	refuseMove(projectId: string, from: string, to: string): Promise<void>;
	/** The Space of a project, a removed one too, or null. */
	spaceOf(projectId: string): Promise<string | null>;
	/** Reads the remote of every project here that has none. */
	readRemotes(): Promise<void>;
};

export function wireClones(deps: ClonesDeps): Projects {
	const find = findProject(deps);
	const listHere = listProjectsHere(deps);
	return {
		list: (spaceId) => listHere(spaceId === undefined ? {} : { spaceId }),
		listInSpace: (spaceId) => deps.store.listInSpace(spaceId),
		find: (projectId, spaceId) =>
			find(spaceId === undefined ? { projectId } : { projectId, spaceId }),
		ofSpace: (spaceId) => deps.store.ofSpace(spaceId),
		matching: (input) => deps.store.matching(input),
		clones: (spaceId, projectId) => listClones(deps)({ spaceId, projectId }),
		clonePath: (projectId, spaceId) => deps.store.clonePath(projectId, spaceId),
		recordClone: (spaceId, clone) => recordClone(deps)({ spaceId, clone }),
		setClones: (spaceId, input) => setClones(deps)({ spaceId, ...input }),
		clonedHere: (spaceId) => listClonedHere(deps)({ spaceId }),
		forgetDevice: (deviceId) => deps.spaceProjects.forgetDevice(deviceId),
		addFromRemote: (spaceId, input) =>
			addProjectFromRemote(deps)({ spaceId, ...input }),
		defineWithoutFolder: (spaceId, input) =>
			defineProjectWithoutFolder(deps)({ spaceId, ...input }),
		take: (spaceId, taken) => deps.spaceProjects.take(spaceId, taken),
		refuseMove: (projectId, from, to) =>
			checkProjectMove(deps)({ projectId, from, to }),
		spaceOf: (projectId) => findProjectSpace(deps)({ projectId }),
		readRemotes: () => readRemotes(deps)(),
	};
}
