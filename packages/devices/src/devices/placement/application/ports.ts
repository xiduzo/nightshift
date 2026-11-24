import type { DeviceCopy } from "@nightshift/engine/settings";

/**
 * The driven ports of placement. Neighbour ports are `@filledBy`; the
 * composition of the package passes them to `wirePlacement`.
 */

/**
 * Person and Space facts Placement needs from auth and links.
 * @filledBy auth
 */
export type SpacePeople = {
	/** The Person as the Space's Host knows them. Null in, when nobody is known, may come back null. */
	personInSpace<P extends string | null>(
		spaceId: string,
		personId: P,
	): Promise<string | P>;
	personalSpaceIdBySlug(personId: string): Promise<string | null>;
	personNames(ids: readonly string[]): Promise<Map<string, string>>;
	keptByHomeHost(spaceId: string): Promise<boolean>;
};

/**
 * The copies of the owner's other Devices.
 * @filledBy engine/settings
 */
export type DeviceCopiesPort = {
	list(): Promise<DeviceCopy[]>;
};
