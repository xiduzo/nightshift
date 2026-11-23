import { type DeviceCopy, withHostName } from "../domain/device-copy";
import type { DeviceDocuments } from "./ports";

export type ReadDeviceCopyPorts = {
	documents: Pick<DeviceDocuments<unknown>, "copyIds" | "openCopy">;
	selfId: string;
	named: ReadonlyMap<string, string>;
};

/** The copy of one Device's document, or null when this computer has none. */
export const readDeviceCopy =
	(ports: ReadDeviceCopyPorts) =>
	async (request: { deviceId: string }): Promise<DeviceCopy | null> => {
		const { deviceId } = request;
		if (deviceId === ports.selfId) return null;
		if (!(await ports.documents.copyIds()).includes(deviceId)) return null;
		const { record } = await ports.documents.openCopy(deviceId);
		return withHostName(record.copy, ports.named);
	};
