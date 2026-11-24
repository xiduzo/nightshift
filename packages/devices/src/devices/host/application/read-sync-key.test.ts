import { describe, expect, test } from "bun:test";
import { documentToken } from "../../../contract";
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
		expect(await readSyncKey(p)(documentToken("tok"))).toEqual({
			deviceId: "laptop",
			personId: "ada",
			home: true,
		});
		// A Device that says no version, or another one.
		for (const token of ["tok", "tok@", "tok@x", "tok@0", "tok@999"]) {
			expect(await readSyncKey(p)(token)).toBeNull();
		}
		p.settings.enabled = false;
		expect(await readSyncKey(p)(documentToken("tok"))).toBeNull();
	});
});
