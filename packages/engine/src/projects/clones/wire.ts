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
	TakenProjects,
} from "../keep";
import { addProjectFromRemote } from "./application/add-project-from-remote";
import { checkProjectMove } from "./application/check-project-move";
import { defineProjectWithoutFolder } from "./application/define-project-without-folder";
import { findClonePath } from "./application/find-clone-path";
import { findProject } from "./application/find-project";
import { findProjectSpace } from "./application/find-project-space";
import { forgetDevice } from "./application/forget-device";
import { listClonedHere } from "./application/list-cloned-here";
import { listClones } from "./application/list-clones";
import { listMovingProjects } from "./application/list-moving-projects";
import { listProjectsHere } from "./application/list-projects-here";
import { listSpaceProjects } from "./application/list-space-projects";
import { matchProjects } from "./application/match-projects";
import type { KnownSpaces } from "./application/ports";
import { readRemotes } from "./application/read-remotes";
import { recordClone } from "./application/record-clone";
import { setClones } from "./application/set-clones";
import { takeProjects } from "./application/take-projects";

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
	ids: NewIds;
	knownSpaces: KnownSpaces;
};

/**
 * The Projects as the engine's other slices and the peers take them: each
 * member is one use case.
 */
export type Projects = {
	/** The projects with a Clone here a person has not removed: the Space's, or every Space's. */
	list(spaceId?: string): Promise<ProjectRow[]>;
	/** Every project a person has not removed, also those without a Clone here. */
	listInSpace(spaceId?: string): Promise<ListedProject[]>;
	/** A project a person has not removed, with its folder here or null. */
	find(projectId: string, spaceId?: string): Promise<ListedProject>;
	/** The projects of a Space, removed ones too, with what this computer has of each. */
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
	/** The folder of the project's Clone here, or null. */
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
	/** Forgets a Device's Clones and its name in the Space documents kept here. */
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
	/** Takes projects into the Space's document, in one change. */
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
	const listSpace = listSpaceProjects(deps);
	const listHere = listProjectsHere(deps);
	return {
		list: (spaceId) => listHere(spaceId === undefined ? {} : { spaceId }),
		listInSpace: (spaceId) =>
			listSpace(spaceId === undefined ? {} : { spaceId }),
		find: (projectId, spaceId) =>
			find(spaceId === undefined ? { projectId } : { projectId, spaceId }),
		ofSpace: (spaceId) => listMovingProjects(deps)({ spaceId }),
		matching: (input) => matchProjects(deps)(input),
		clones: (spaceId, projectId) => listClones(deps)({ spaceId, projectId }),
		clonePath: (projectId, spaceId) =>
			findClonePath(deps)({ projectId, spaceId }),
		recordClone: (spaceId, clone) => recordClone(deps)({ spaceId, clone }),
		setClones: (spaceId, input) => setClones(deps)({ spaceId, ...input }),
		clonedHere: (spaceId) => listClonedHere(deps)({ spaceId }),
		forgetDevice: (deviceId) => forgetDevice(deps)({ deviceId }),
		addFromRemote: (spaceId, input) =>
			addProjectFromRemote(deps)({ spaceId, ...input }),
		defineWithoutFolder: (spaceId, input) =>
			defineProjectWithoutFolder(deps)({ spaceId, ...input }),
		take: (spaceId, taken) => takeProjects(deps)({ spaceId, taken }),
		refuseMove: (projectId, from, to) =>
			checkProjectMove(deps)({ projectId, from, to }),
		spaceOf: (projectId) => findProjectSpace(deps)({ projectId }),
		readRemotes: () => readRemotes(deps)(),
	};
}
