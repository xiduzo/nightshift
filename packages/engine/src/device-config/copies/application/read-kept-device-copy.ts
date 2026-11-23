import type { DeviceCopy } from "../domain/device-copy";
import type { DeviceDocuments } from "./ports";

export type ReadKeptDeviceCopyPorts = {
	documents: Pick<DeviceDocuments<unknown>, "readKept">;
};

/**
 * What a Host's Device document of a Device whose home Host it is says of
 * that Device. Null when it keeps none.
 */
export const readKeptDeviceCopy =
	(ports: ReadKeptDeviceCopyPorts) =>
	async (request: { deviceId: string }): Promise<DeviceCopy | null> =>
		(await ports.documents.readKept(request.deviceId))?.copy ?? null;
