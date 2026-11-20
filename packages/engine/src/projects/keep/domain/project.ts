import { Refusal } from "@nightshift/refusal";
import { instant } from "@nightshift/time";

/**
 * Projects by remote, and their Clones. A Project with a folder is a
 * repository by its normalised `origin`; a Clone is that repository's
 * folder on one Device. This computer has at most one Clone of a
 * Project, and the engine works in it.
 *
 * - Adding a folder whose `origin` names a Project already known makes a
 *   Clone of it, not a second Project. A folder without a remote is a
 *   Project of its own, on this computer only.
 * - A Project without a folder (`folder` false, ADR 22) has no remote and
 *   no Clone, on any Device. It never gets a folder, and a Clone of it is
 *   never recorded.
 * - A Project is in exactly one Space. A folder or a remote that is a
 *   Project of another Space is refused, never joined across Spaces.
 * - A Project's definition (name, remote, removed) is written to its Space
 *   document; the `project` row follows as its projection. A Clone here is
 *   a `clone` row (with its path) and an entry in the Space document
 *   (without one).
 * - In a Space a Host keeps, the document is the Host's: a Clone here is
 *   recorded there through the Host, and the Projects themselves change on
 *   the Host only.
 */

/** A call that needs the project's folder on this computer, for a project without one. */
export const NOT_ON_THIS_COMPUTER =
	"This project is not on this computer. Add its folder here to use it.";

/** A change this Replica cannot make to a Space a Host keeps. */
export const HOSTED_ELSEWHERE =
	"Your Host keeps the projects of this Space. Change them on your Host.";

/** A project that is not in the Space, or that a person removed. */
export const PROJECT_NOT_FOUND = "Night Shift cannot find this project.";

/** A folder for a project without one: it cannot get one (ADR 22). */
export const NO_FOLDER =
	"This project has no folder, and it cannot get one. Add the folder as a new project instead.";

/** A folder that is a project of another Space. */
export const IN_ANOTHER_SPACE =
	"This folder is a project in another Space. Switch to that Space to use it.";

/** A project row, as the `project` table holds it. */
export type ProjectRecord = {
	id: string;
	spaceId: string;
	name: string;
	/** The normalised `origin` (`github.com/acme/app`), null without one. */
	remote: string | null;
	/** False: a project without a folder (ADR 22). */
	folder: boolean;
	createdAt: Date;
	/** Set when a person removed the project. */
	removedAt: Date | null;
};

/** A project row with the path of its Clone on this computer. */
export type ProjectRow = ProjectRecord & { repoPath: string };

/** A project row with the path of its Clone here, or null: not on this computer. */
export type ListedProject = ProjectRecord & { repoPath: string | null };

/** A Project's row as a merge of Spaces reads it. */
export type MovingProject = {
	id: string;
	spaceId: string;
	name: string;
	remote: string | null;
	/** False: a project without a folder (ADR 22). */
	folder: boolean;
	createdAt: number;
	removedAt: number | null;
};

/** A Device's Clone of a Project, as a Space document records it. */
export type CloneRecord = {
	projectId: string;
	deviceId: string;
	/** The Device's name, as the document shows it. */
	deviceName: string;
};

/** What a Host takes into a Space's document at once. */
export type TakenProjects = {
	/** Projects new to the Space: each written only where the document has no entry of it. */
	define?: readonly Omit<MovingProject, "spaceId">[];
	/** Projects a person removed, by id: they come back. */
	restore?: readonly string[];
	/** The Clones of a Device. */
	clones?: readonly CloneRecord[];
};

/** A Device with a Clone of a Project, as the Space document says. */
export type DocumentClone = { deviceId: string; deviceName: string | null };

export type Project = {
	id: string;
	name: string;
	/**
	 * The folder of the project's Clone on this computer. Null: the project
	 * is not on this computer (another Device of the Space has it); a call
	 * that needs its folder (flows, branches, schedules, a run walked here)
	 * fails until a folder of it is added.
	 */
	repoPath: string | null;
	/** The normalised `origin` (`github.com/acme/app`), null without one. */
	remote: string | null;
	/**
	 * False: the project has no folder (ADR 22). It has no remote and no
	 * Clone, and each of its runs gets an empty folder of its own.
	 */
	folder: boolean;
	createdAt: number;
	/** The Devices with a Clone of it, from the Space document: this one first. */
	clones: ProjectClone[];
};

/** That a Device has a Clone of a Project. Its path is that Device's own. */
export type ProjectClone = {
	deviceId: string;
	/** The Device's name, as the Space document has it. */
	deviceName: string | null;
	/** This computer. */
	thisDevice: boolean;
};

/**
 * The engine's Project: the row, with the Devices that have a Clone of it
 * (from the Space document).
 */
export function toProject(
	row: ListedProject,
	clones: readonly DocumentClone[],
	deviceId: string,
): Project {
	const listed = clones.map((c) => ({
		deviceId: c.deviceId,
		deviceName: c.deviceName,
		thisDevice: c.deviceId === deviceId,
	}));
	// A row the document has not seen yet still has its Clone here.
	if (row.repoPath !== null && !listed.some((c) => c.thisDevice)) {
		listed.unshift({ deviceId, deviceName: null, thisDevice: true });
	}
	return {
		id: row.id,
		name: row.name,
		repoPath: row.repoPath,
		remote: row.remote,
		folder: row.folder,
		createdAt: instant(row.createdAt),
		clones: listed,
	};
}

/** The row, when it is in the Space. A folder is one Space's project at a time. */
export function ownSpace<T extends { spaceId: string }>(
	row: T,
	spaceId: string,
): T {
	if (row.spaceId !== spaceId) {
		throw new Refusal("conflict", IN_ANOTHER_SPACE);
	}
	return row;
}

/** Which projects with a Clone on this computer: every part given must hold. */
export type ProjectsHere = {
	/** The Clone's folder. */
	path?: string;
	projectId?: string;
	spaceId?: string;
	/** Only projects a person has not removed. */
	kept?: true;
	/** Only projects without a remote. */
	withoutRemote?: true;
};

/** A project of a Space, removed ones too, with what this computer has of it. */
export type SpaceProjectRow = MovingProject & {
	/** This computer has a Clone of it. */
	clone: boolean;
	/** This computer walked a run of it in the Space. */
	walked: boolean;
};

/** A Clone on this computer, as its row is written. */
export type CloneHere = {
	spaceId: string;
	projectId: string;
	deviceId: string;
	path: string;
};

/** The entry of a new Project in its Space document. */
export type NewProjectEntry = {
	name: string;
	remote: string | null;
	folder: boolean;
};

/** A change of a Project's entry in its Space document. */
export type ProjectEntryChange = {
	name?: string;
	remote?: string | null;
	/** True: a person removed the Project. False: it comes back. */
	removed?: boolean;
};
