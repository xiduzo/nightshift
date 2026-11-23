import type { DeviceDocuments } from "../../application/ports";
import type { DeviceRecord } from "../../domain/device-copy";

/** An empty record: a copy before its first sync. */
function emptyRecord(deviceId: string): DeviceRecord {
	return {
		copy: {
			deviceId,
			name: null,
			platform: null,
			profiles: [],
			secrets: [],
			checkedAt: null,
		},
		profiles: [],
	};
}

/**
 * The Device documents in memory, for the use-case tests. A copy "syncs"
 * as its record: a test changes it with `sync`.
 */
export function inMemoryDeviceDocuments() {
	const kept = new Map<string, DeviceRecord>();
	const copies = new Map<string, DeviceRecord>();
	const dropped: string[] = [];
	const twin = {
		copyIds: async () => [...copies.keys()],
		async openCopy(deviceId: string) {
			const record = copies.get(deviceId) ?? emptyRecord(deviceId);
			copies.set(deviceId, record);
			return { record, doc: record, syncName: `device:${deviceId}` };
		},
		async dropCopy(deviceId: string) {
			dropped.push(deviceId);
			copies.delete(deviceId);
		},
		readKept: async (deviceId: string) => kept.get(deviceId) ?? null,
		readStoredCopy: async (deviceId: string) => copies.get(deviceId) ?? null,
		async readAll() {
			const all = new Map([...copies, ...kept]);
			return [...all.keys()].sort().flatMap((id) => {
				const record = all.get(id);
				return record ? [record.copy] : [];
			});
		},
		/** Writes what the sync of a copy brings. */
		sync(record: DeviceRecord) {
			copies.set(record.copy.deviceId, record);
		},
		/** Writes the document a Host keeps for one of its Devices. */
		keep(record: DeviceRecord) {
			kept.set(record.copy.deviceId, record);
		},
		/** The copies dropped, in order. */
		dropped,
	};
	return twin satisfies DeviceDocuments<DeviceRecord>;
}
