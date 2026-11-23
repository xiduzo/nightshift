import { describe, expect, test } from "bun:test";
import { inMemoryHostPorts } from "../adapters/out/in-memory-neighbours";
import { readSyncKey } from "./read-sync-key";

describe("readSyncKey", () => {
	test("a sync key of a Device with access, and nothing while Be a Host is off", async () => {
		const p = inMemoryHostPorts();
		p.keys.access.set("tok:sync", {
			keyId: "k",
			deviceId: "laptop",
			personId: "ada",
			permissions: { sync: ["pull"] },
		});
		p.registry.put({
			id: "laptop",
			name: "laptop",
			platform: "test",
			ownerId: "ada",
			homeHost: "https://studio.invalid",
			lastSeenAt: null,
			online: true,
			pairedAt: 0,
			revokedAt: null,
		});
		expect(await readSyncKey(p)("tok")).toEqual({
			deviceId: "laptop",
			personId: "ada",
			home: true,
		});
		p.settings.enabled = false;
		expect(await readSyncKey(p)("tok")).toBeNull();
	});
});
