import type { RowBatch } from "../../../contract";
import type { Branches } from "../../../git";
import type { EnginePayloads } from "../../../log";
import type {
	CloneHere,
	CloneRecord,
	DocumentClone,
	ListedProject,
	MovingProject,
	NewProjectEntry,
	ProjectEntryChange,
	ProjectRecord,
	ProjectRow,
	ProjectsHere,
	SpaceProjectRow,
	TakenProjects,
} from "../domain/project";

/**
 * The driven ports the requests of the Projects share: the rows, the Space
 * documents, the log, git, the Device directory and the Host relay. A port
 * of its own has a real adapter, an in-memory adapter and a contract suite
 * in `adapters/out/`. Another vertical fills a port with `@filledBy`.
 */

/** The `project` and `clone` rows of this Replica. */
export type ProjectStore = {
	/** The project's row, removed or not. Null: this Replica lacks it. */
	row(projectId: string): Promise<ProjectRecord | null>;
	/**
	 * A project a person has not removed, with its folder here or null.
	 * With a Space, a project of another Space is null.
	 */
	find(projectId: string, spaceId?: string): Promise<ListedProject | null>;
	/**
	 * Every project a person has not removed, oldest first, with its folder
	 * here or null. Without a Space, every Space's.
	 */
	listInSpace(spaceId?: string): Promise<ListedProject[]>;
	/** The projects with a Clone on this computer, with its path, oldest first. */
	here(filter: ProjectsHere): Promise<ProjectRow[]>;
	/** The project with this remote, in any Space, removed or not. */
	byRemote(remote: string): Promise<ProjectRecord | null>;
	/**
	 * The folder of the project's Clone on this computer, or null: none
	 * here, a project a person removed, or one of another Space.
	 */
	clonePath(projectId: string, spaceId?: string): Promise<string | null>;
	/**
	 * Whether a project has no folder (ADR 22). False for a project this
	 * Replica does not know, or that a person removed.
	 */
	withoutFolder(projectId: string): Promise<boolean>;
	/**
	 * The projects of a Space, removed ones too, oldest first, with whether
	 * this computer has a Clone of each and walked a run of it there.
	 */
	ofSpace(spaceId: string): Promise<SpaceProjectRow[]>;
	/** The projects with one of `ids` or one of `remotes`, in any Space, removed ones too. */
	matching(input: {
		ids?: readonly string[];
		remotes?: readonly string[];
	}): Promise<MovingProject[]>;
	/** Keeps the row of a project a Host added, at once. A removed one of the Space comes back. */
	keepHosted(row: {
		id: string;
		spaceId: string;
		name: string;
		remote: string;
	}): Promise<void>;
	/** Keeps the row of a project without a folder a Host added, at once. A row it has stays. */
	keepHostedWithoutFolder(row: {
		id: string;
		spaceId: string;
		name: string;
	}): Promise<void>;
	/** Writes the row of a new Clone here. */
	addClone(clone: CloneHere): Promise<void>;
	/**
	 * The statement of a Clone here, for the batch of its event: a new row,
	 * or the path of the one this Device has (`moved`). It reads nothing.
	 */
	cloneRow(clone: CloneHere & { moved: boolean }): RowBatch;
	/** The statement that forgets the Clones of a Device that is gone. It reads nothing. */
	forgetClones(deviceId: string): RowBatch;
	/** The statement that makes the Clones of `from` those of `to` (ADR 20). It reads nothing. */
	adoptClones(from: string, to: string): RowBatch;
};

/**
 * The Projects and Clones of the Space documents this Replica writes. Each
 * write is one change of one document. A Space a Host keeps is that
 * Host's: a write to it changes nothing and says so.
 */
export type SpaceProjects = {
	/**
	 * Changes the Project's entry. An entry the document lacks (a row from
	 * before it) starts from the row. False: a Host keeps the Space.
	 */
	define(row: ProjectRecord, change: ProjectEntryChange): Promise<boolean>;
	/** Writes the entry of a new Project. False: a Host keeps the Space. */
	create(
		spaceId: string,
		projectId: string,
		entry: NewProjectEntry,
	): Promise<boolean>;
	/** Records this Device's Clone. False: a Host keeps the Space, nothing changes. */
	recordCloneHere(spaceId: string, clone: CloneRecord): Promise<boolean>;
	/**
	 * Records another Device's Clone, on the Replica that keeps the Space:
	 * `unknown` when a Host keeps it or its document has no entry of the
	 * Project, `without-folder` for a Project without a folder.
	 */
	recordClone(
		spaceId: string,
		clone: CloneRecord,
	): Promise<"recorded" | "unknown" | "without-folder">;
	/**
	 * Makes a Device's Clones in the document exactly the Projects it says
	 * it has, leaving out a Project the document lacks and one without a
	 * folder. In step: no change. Null: a Host keeps the Space.
	 */
	setClones(
		spaceId: string,
		input: {
			deviceId: string;
			deviceName: string;
			projectIds: readonly string[];
		},
	): Promise<{ added: string[]; removed: string[] } | null>;
	/** Takes Projects into the document in one change. A Space a Host keeps is left alone. */
	take(spaceId: string, taken: TakenProjects): Promise<void>;
	/** Removes a Device's Clones and its name from every document this Replica keeps. */
	forgetDevice(deviceId: string): Promise<void>;
	/** The Devices with a Clone of each Project, oldest Clone first: one read of the document. */
	clones(
		spaceId: string,
		projectIds: readonly string[],
	): Promise<Map<string, DocumentClone[]>>;
};

/**
 * The event log, for the facts of the Projects.
 * @filledBy engine/log
 */
export type ProjectLog = {
	/** Appends the fact. `before` runs first, in the same batch. */
	append(
		fact: {
			[T in
				| "ProjectAdded"
				| "ProjectRestored"
				| "ProjectRemoved"
				| "ProjectRenamed"
				| "CloneAdded"]: { type: T; payload: EnginePayloads[T] };
		}[
			| "ProjectAdded"
			| "ProjectRestored"
			| "ProjectRemoved"
			| "ProjectRenamed"
			| "CloneAdded"],
		before?: RowBatch,
	): Promise<void>;
};

/**
 * This computer as a Device.
 * @filledBy engine/log
 */
export type ThisDevice = {
	deviceId(): Promise<string>;
};

/**
 * The git repositories on this computer.
 * @filledBy engine/git
 */
export type Repos = {
	/** The top folder of the repository at `path`. Throws when it is none. */
	topLevel(path: string): Promise<string>;
	/** The URL of its `origin`, or null. */
	origin(path: string): Promise<string | null>;
	/** The local and remote branches of the repository at `path`. */
	branches(path: string): Promise<Branches>;
	/** Whether the folder is there. */
	exists(path: string): boolean;
};

/**
 * The names of Devices, and the Spaces a Host keeps.
 * @filledBy devices/devices
 */
export type ProjectDirectory = {
	names(deviceIds: readonly string[]): Promise<Map<string, string>>;
	hostedElsewhere(spaceId: string): Promise<boolean>;
};

/**
 * The Spaces whose Projects a Space move takes now.
 * @filledBy engine/runs
 */
export type SpaceHolds = {
	/**
	 * Does `work`, which makes a Project in the Space. A move out of the Space
	 * waits for it. Refused while a move out of the Space runs.
	 */
	unlessHeld<T>(spaceId: string, work: () => Promise<T>): Promise<T>;
};

/**
 * New ids.
 * @filledBy engine/wire
 */
export type NewIds = {
	projectId(): string;
};
