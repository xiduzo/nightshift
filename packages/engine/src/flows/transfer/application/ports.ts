import type { FlowMigration } from "@nightshift/flows";
import type { UsageMoment } from "../../../usage";

/**
 * The driven ports of `flows/transfer`. Another slice or package fills each
 * port: the composition of the engine passes it to `wireTransfer`.
 */

/**
 * The clock of a merge.
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
