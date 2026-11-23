import { describe, expect, test } from "bun:test";
import { inMemoryDeviceDocuments } from "../adapters/out/in-memory-device-documents";
import { readDeviceCopy } from "./read-device-copy";

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

describe("readDeviceCopy", () => {
	test("reads a kept copy, and null for this computer or a Device with no copy", async () => {
		const documents = inMemoryDeviceDocuments();
		documents.sync(record("laptop", "Laptop"));
		documents.sync(record("me", "Me"));
		const read = readDeviceCopy({ documents, selfId: "me", named: new Map() });
		expect((await read({ deviceId: "laptop" }))?.name).toBe("Laptop");
		expect(await read({ deviceId: "me" })).toBeNull();
		expect(await read({ deviceId: "desktop" })).toBeNull();
		expect(await documents.copyIds()).not.toContain("desktop");
	});
});
