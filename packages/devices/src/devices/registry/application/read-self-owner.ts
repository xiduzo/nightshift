import type { DeviceStore } from "./ports";

export type ReadSelfOwnerPorts = { store: Pick<DeviceStore, "selfOwnerId"> };

/**
 * The Person who owns this computer's Device, or null before one does.
 *
 * Night Shift asks it: the use case takes no request.
 */
export const readSelfOwner =
	(ports: ReadSelfOwnerPorts) => async (): Promise<string | null> =>
		ports.store.selfOwnerId();
