import { describe, expect, test } from "bun:test";
import { inMemoryDeviceDocuments } from "../adapters/out/in-memory-device-documents";
import { readLastKnownProfiles } from "./read-last-known-profiles";

const builder = {
	id: "p-1",
	name: "builder",
	description: "Builds",
	updatedAt: 3,
	harness: "claude-code",
	model: "sonnet",
	permissionMode: "acceptEdits",
	clis: [],
	connections: [],
} as const;

function record(deviceId: string, profiles: (typeof builder)[]) {
	return {
		copy: {
			deviceId,
			name: null,
			platform: null,
			profiles: [],
			secrets: [],
			checkedAt: null,
		},
		profiles: profiles.map((p) => ({ ...p, clis: [], connections: [] })),
	};
}

describe("readLastKnownProfiles", () => {
	test("reads the profiles by id from the kept document, else the copy, else null", async () => {
		const documents = inMemoryDeviceDocuments();
		const read = readLastKnownProfiles({ documents });
		expect(await read({ deviceId: "laptop" })).toBeNull();
		documents.sync(record("laptop", [builder]));
		expect(await read({ deviceId: "laptop" })).toEqual(
			new Map([
				[
					"p-1",
					{
						name: "builder",
						settings: {
							harness: "claude-code",
							model: "sonnet",
							permissionMode: "acceptEdits",
							clis: [],
							connections: [],
						},
					},
				],
			]),
		);
		documents.keep(record("laptop", []));
		expect(await read({ deviceId: "laptop" })).toEqual(new Map());
	});
});
