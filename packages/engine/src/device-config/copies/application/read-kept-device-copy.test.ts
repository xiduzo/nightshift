import { describe, expect, test } from "bun:test";
import { inMemoryDeviceDocuments } from "../adapters/out/in-memory-device-documents";
import { readKeptDeviceCopy } from "./read-kept-device-copy";

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

describe("readKeptDeviceCopy", () => {
	test("reads only the document a Host keeps, never a copy", async () => {
		const documents = inMemoryDeviceDocuments();
		documents.sync(record("laptop", "Copy"));
		const read = readKeptDeviceCopy({ documents });
		expect(await read({ deviceId: "laptop" })).toBeNull();
		documents.keep(record("laptop", "Kept"));
		expect((await read({ deviceId: "laptop" }))?.name).toBe("Kept");
	});
});
