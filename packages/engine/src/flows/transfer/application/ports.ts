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
 * Anonymous usage, when this computer records it.
 * @filledBy engine/usage
 */
export type FlowUsage = {
	note(moment: UsageMoment): void;
};
