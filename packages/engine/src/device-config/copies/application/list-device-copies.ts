import {
	copiesInOrder,
	type DeviceCopy,
	withHostName,
} from "../domain/device-copy";
import type { DeviceDocuments } from "./ports";

export type ListDeviceCopiesPorts = {
	documents: Pick<DeviceDocuments<unknown>, "copyIds" | "openCopy">;
	selfId: string;
	named: ReadonlyMap<string, string>;
};

/** Every copy this computer keeps, by Device name. */
export const listDeviceCopies =
	(ports: ListDeviceCopiesPorts) => async (): Promise<DeviceCopy[]> => {
		const ids = (await ports.documents.copyIds()).filter(
			(id) => id !== ports.selfId,
		);
		const copies = await Promise.all(
			ids.map(async (id) =>
				withHostName(
					(await ports.documents.openCopy(id)).record.copy,
					ports.named,
				),
			),
		);
		return copiesInOrder(copies);
	};
