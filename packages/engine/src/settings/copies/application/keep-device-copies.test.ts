import { describe, expect, test } from "bun:test";
import { inMemoryDeviceDocuments } from "../adapters/out/in-memory-device-documents";
import { keepDeviceCopies } from "./keep-device-copies";

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

describe("keepDeviceCopies", () => {
	test("keeps a copy of each listed Device, drops the rest, and never copies this computer", async () => {
		const documents = inMemoryDeviceDocuments();
		documents.sync(record("old", "Old"));
		const named = new Map<string, string>([["old", "Old"]]);
		const keep = keepDeviceCopies({ documents, selfId: "me", named });
		const synced = await keep([
			{ id: "laptop", name: "Laptop" },
			{ id: "desktop", name: "Desktop" },
			{ id: "me", name: "This one" },
		]);
		expect(synced.map((s) => s.name)).toEqual([
			"device:desktop",
			"device:laptop",
		]);
		expect(documents.dropped).toEqual(["old"]);
		expect([...named]).toEqual([
			["laptop", "Laptop"],
			["desktop", "Desktop"],
		]);
	});
});
