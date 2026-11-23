import type { DeviceDirectory } from "../../../contract";
import type { NamedProfile, SpaceDeviceMaps } from "../domain/device-names";

/**
 * The driven ports of `flows/migrations`. Each is filled by another slice
 * or package: the composition of the engine passes it to `wireMigrations`.
 */

/**
 * This Device, by the name it has now.
 * @filledBy engine/wire
 */
export type ThisDevice = {
	device(): Promise<{ id: string; name: string }>;
};

/**
 * The Device documents this Replica keeps or copies (`listStoredDevices`).
 * @filledBy engine/settings
 */
export type StoredDevices = {
	list(): Promise<
		readonly {
			deviceId: string;
			name: string | null;
			profiles: readonly NamedProfile[];
		}[]
	>;
};

/**
 * This Device's profiles, fresher than its stored document.
 * @filledBy engine/settings
 */
export type DeviceProfiles = {
	list(): readonly NamedProfile[];
};

/**
 * The Device rows of this Replica: their names and owners (on a Host,
 * every paired Device), and the owner of this computer.
 * @filledBy devices
 */
export type KnownDevices = Pick<DeviceDirectory, "known" | "selfOwnerId">;

/**
 * The Space documents: the Devices and Offers of a Space.
 * @filledBy engine/documents
 */
export type SpaceDevices = {
	open(spaceId: string): Promise<SpaceDeviceMaps>;
};
