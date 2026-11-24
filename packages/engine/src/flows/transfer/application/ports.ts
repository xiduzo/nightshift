import type { FlowMigration } from "@nightshift/flows";
import type { UsageMoment } from "../../../usage";
import type { CloneHere } from "../domain/clone-import";
import type { LegacyFolder, TrackedState } from "../domain/legacy-folder";

/**
 * The driven ports of `flows/transfer`. `CloneFolders` and `ClonesHere`
 * are its own: each has a real adapter, an in-memory adapter and a
 * contract suite in `adapters/out/`. Another slice or package fills each
 * other port: the composition of the engine passes it to `wireTransfer`.
 */

/**
 * The `.nightshift/` folder of a Clone on this computer, from before
 * ADR 2.
 */
export type CloneFolders = {
	/**
	 * Reads the folder. Null when the Clone has none. A link or a file of
	 * that name is not read: it is `unknown`, so it stays.
	 */
	read(repoPath: string): Promise<LegacyFolder | null>;
	/**
	 * How much of the folder git tracks: none of its files, all of them, or
	 * some. Throws when git cannot tell (no repository, no git).
	 */
	tracked(
		repoPath: string,
		folder: Pick<LegacyFolder, "files">,
	): Promise<TrackedState>;
	/**
	 * Deletes the files the import read, each only while it still holds what
	 * was read, then the folders when they are empty. Never removes what it
	 * did not read. True when the folder is gone.
	 */
	remove(
		repoPath: string,
		folder: Pick<LegacyFolder, "files">,
	): Promise<boolean>;
};

/** The Clones of a Device whose Project is not removed. */
export type ClonesHere = {
	/** The Clones of the Device, of one project when `projectId` is set, oldest first. */
	list(deviceId: string, projectId?: string): Promise<CloneHere[]>;
};

/**
 * Writes every document the import changed to the database.
 * @filledBy engine/documents
 */
export type SavedDocuments = {
	flush(): Promise<void>;
};

/**
 * This Device: the owner of its Clones, and the name a notice gives it.
 * @filledBy engine/wire
 */
export type ThisDevice = {
	device(): Promise<{ id: string; name: string }>;
};

/**
 * The clock of an import.
 * @filledBy engine/wire
 */
export type Clock = () => number;

/**
 * The projects of a Space, for the one check of every verb of a Person.
 * @filledBy engine/wire
 */
export type SpaceProjects = {
	/**
	 * Waits for the engine to be ready, then refuses (`not-found`) a project
	 * that is not in the Space: the same answer as one that does not exist.
	 */
	inSpace(projectId: string, spaceId: string): Promise<void>;
};

/**
 * What brings an imported file of an older format to the current format:
 * its nodes name the profiles of this Device, the one that imports it,
 * and the Devices of the Space by id, the Person's own first.
 * @filledBy engine/wire
 */
export type ImportMigrations = {
	forScope(scope: {
		spaceId: string;
		personId: string | null;
	}): Promise<FlowMigration>;
};

/**
 * Anonymous usage, when this computer records it.
 * @filledBy engine/usage
 */
export type FlowUsage = {
	note(moment: UsageMoment): void;
};
