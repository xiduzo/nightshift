import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { DeviceDocuments } from "../../application/ports";

/** One store to test: what an adapter of `DeviceDocuments` gives the suite. */
export type DeviceDocumentsUnderTest = {
	documents: DeviceDocuments<unknown>;
	/** Writes the document a Host keeps for one of its Devices, with the name it reports. */
	writeKept(deviceId: string, name: string): Promise<void>;
	/** Writes what the sync of a copy brings: the name its Device reports. */
	writeCopy(deviceId: string, name: string): Promise<void>;
	close(): Promise<void>;
};

/**
 * What every adapter of `DeviceDocuments` does.
 * `device-documents.contract.test.ts` runs it on the in-memory adapter and
 * on the one over the `ydoc` rows.
 */
export function deviceDocumentsContract(
	name: string,
	open: () => Promise<DeviceDocumentsUnderTest>,
) {
	describe(`DeviceDocuments contract: ${name}`, () => {
		let under: DeviceDocumentsUnderTest;
		beforeEach(async () => {
			under = await open();
		});
		afterEach(async () => {
			await under.close();
		});

		test("a Replica with no Device documents has no copy and no record", async () => {
			expect(await under.documents.copyIds()).toEqual([]);
			expect(await under.documents.readAll()).toEqual([]);
			expect(await under.documents.readKept("laptop")).toBeNull();
			expect(await under.documents.readStoredCopy("laptop")).toBeNull();
		});

		test("opening a copy makes an empty one, which syncs under the Device document name", async () => {
			const opened = await under.documents.openCopy("laptop");
			expect(opened.syncName).toBe("device:laptop");
			expect(opened.record.copy).toEqual({
				deviceId: "laptop",
				name: null,
				platform: null,
				profiles: [],
				secrets: [],
				checkedAt: null,
			});
			expect(await under.documents.copyIds()).toEqual(["laptop"]);
		});

		test("a synced copy reads as its Device says, and goes when it is dropped", async () => {
			await under.writeCopy("laptop", "Laptop");
			expect((await under.documents.readStoredCopy("laptop"))?.copy.name).toBe(
				"Laptop",
			);
			expect((await under.documents.openCopy("laptop")).record.copy.name).toBe(
				"Laptop",
			);
			await under.documents.dropCopy("laptop");
			expect(await under.documents.copyIds()).toEqual([]);
			expect(await under.documents.readStoredCopy("laptop")).toBeNull();
		});

		test("a kept document wins over a copy of the same Device", async () => {
			await under.writeCopy("laptop", "Copy");
			await under.writeKept("laptop", "Kept");
			await under.writeCopy("desktop", "Desktop");
			const all = await under.documents.readAll();
			expect(
				all
					.map((c) => [c.deviceId, c.name])
					.sort(([a], [b]) => (a ?? "").localeCompare(b ?? "")),
			).toEqual([
				["desktop", "Desktop"],
				["laptop", "Kept"],
			]);
			expect((await under.documents.readKept("laptop"))?.copy.name).toBe(
				"Kept",
			);
		});
	});
}
