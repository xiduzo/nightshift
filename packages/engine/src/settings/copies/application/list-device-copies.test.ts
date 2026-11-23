import { describe, expect, test } from "bun:test";
import { inMemoryDeviceDocuments } from "../adapters/out/in-memory-device-documents";
import { listDeviceCopies } from "./list-device-copies";

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

describe("listDeviceCopies", () => {
	test("lists the copies by name, with the Host's name for one that reports none", async () => {
		const documents = inMemoryDeviceDocuments();
		documents.sync(record("b", "Zed"));
		documents.sync(record("a", null));
		documents.sync(record("me", "Me"));
		const list = listDeviceCopies({
			documents,
			selfId: "me",
			named: new Map([["a", "Alpha"]]),
		});
		expect((await list()).map((c) => [c.deviceId, c.name])).toEqual([
			["a", "Alpha"],
			["b", "Zed"],
		]);
	});
});
