import type { DeviceCopy, DeviceRecord } from "../domain/device-copy";

/**
 * The Device documents this Replica keeps: its own (`device:<id>`), those
 * a Host keeps for the Devices whose home it is, and the copies of its
 * owner's other Devices (`device-copy:<id>`). A copy syncs under the
 * Device document name. Nothing here writes a copy: only the sync does.
 * `Doc` is the document a copy syncs as.
 */
export type DeviceDocuments<Doc> = {
	/** The Device ids of the copies: stored, and opened before their first write. */
	copyIds(): Promise<string[]>;
	/** Opens the copy of a Device, made empty when there is none, with the name it syncs under. */
	openCopy(
		deviceId: string,
	): Promise<{ record: DeviceRecord; doc: Doc; syncName: string }>;
	/** Drops the copy of a Device. */
	dropCopy(deviceId: string): Promise<void>;
	/** What the document a Host keeps for a Device says, or null when it keeps none. */
	readKept(deviceId: string): Promise<DeviceRecord | null>;
	/** What the stored copy of a Device says, or null when there is none. Opens nothing. */
	readStoredCopy(deviceId: string): Promise<DeviceRecord | null>;
	/**
	 * Every Device whose document this Replica keeps, one entry per
	 * Device: a kept document wins over a copy. A document this version
	 * cannot read names no Device.
	 */
	readAll(): Promise<DeviceCopy[]>;
};
