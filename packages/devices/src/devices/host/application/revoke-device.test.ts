import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import { inMemoryHostPorts } from "../adapters/out/in-memory-neighbours";
import { NOT_YOURS_HERE } from "../domain/words";
import { revokeDevice } from "./revoke-device";

describe("revokeDevice", () => {
	test("the Person's own Device loses its key and its connections", async () => {
		const p = inMemoryHostPorts();
		p.registry.put({
			id: "laptop",
			name: "laptop",
			platform: "test",
			ownerId: "person-ada",
			homeHost: "https://studio.invalid",
			lastSeenAt: null,
			online: true,
			pairedAt: 0,
			revokedAt: null,
		});
		await revokeDevice(p)({ personId: "person-ada", deviceId: "laptop" });
		expect(p.keys.revoked).toEqual(["laptop"]);
		expect((await p.registry.get("laptop"))?.revokedAt).not.toBeNull();
		expect(p.relay.ids).toEqual(["laptop"]);
	});

	test("another Person's Device is refused", async () => {
		const p = inMemoryHostPorts();
		p.registry.put({
			id: "laptop",
			name: "laptop",
			platform: "test",
			ownerId: "person-ada",
			homeHost: "https://studio.invalid",
			lastSeenAt: null,
			online: true,
			pairedAt: 0,
			revokedAt: null,
		});
		const refused = revokeDevice(p)({
			personId: "person-bob",
			deviceId: "laptop",
		});
		await expect(refused).rejects.toBeInstanceOf(Refusal);
		await expect(refused).rejects.toThrow(NOT_YOURS_HERE);
	});
});
