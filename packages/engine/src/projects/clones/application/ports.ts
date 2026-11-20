/**
 * The driven ports of what Night Shift and the Host ask of the Projects,
 * beside the shared ones of `keep`. Another vertical fills each
 * (`@filledBy`): the engine's composition passes it to `wireClones`.
 */

/**
 * Whether a Space exists on this Replica.
 * @filledBy auth/spaces
 */
export type KnownSpaces = {
	exists(spaceId: string): Promise<boolean>;
};
