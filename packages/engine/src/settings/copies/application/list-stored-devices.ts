import type { DeviceCopy } from "../domain/device-copy";
import type { DeviceDocuments } from "./ports";

export type ListStoredDevicesPorts = {
	documents: Pick<DeviceDocuments<unknown>, "readAll">;
};

/**
 * Every Device whose document this Replica keeps, as that document says:
 * its own, those a Host keeps for the Devices whose home it is, and the
 * copies of its owner's other Devices. One entry per Device: a kept
 * document wins over a copy.
 */
export const listStoredDevices =
	(ports: ListStoredDevicesPorts) => (): Promise<DeviceCopy[]> =>
		ports.documents.readAll();
