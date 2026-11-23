import { describe, expect, test } from "bun:test";
import { inMemoryDeviceDocuments } from "../adapters/out/in-memory-device-documents";
import { listStoredDevices } from "./list-stored-devices";

function record(deviceId: string, name: string | null) {
	return {
		copy: {
			deviceId,
			name,
			platform: null,
			profiles: [],
			secrets: [],
			checkedAt: null,
		},
		profiles: [],
	};
}

describe("listStoredDevices", () => {
	test("lists each Device once: a kept document wins over a copy", async () => {
		const documents = inMemoryDeviceDocuments();
		documents.sync(record("laptop", "Copy"));
		documents.keep(record("laptop", "Kept"));
		expect(
			(await listStoredDevices({ documents })()).map((c) => c.name),
		).toEqual(["Kept"]);
	});
});
