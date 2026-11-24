import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import { registryPorts } from "../test-support";
import { revokeDevice } from "./revoke-device";

/** The use case revokeDevice, over a database in memory. */

async function ports() {
	const ports = await registryPorts();
	ports.spaces.add("person-ada");
	await ports.add({ id: "device-b", ownerId: "person-ada" });
	return ports;
}

describe("revokeDevice", () => {
	test("revoking ends access: DeviceRevoked with the row, then offline", async () => {
		const p = await ports();
		p.online.set("device-b", p.now());
		await revokeDevice(p)({ id: "device-b" });
		expect((await p.store.paired("device-b"))?.revokedAt).toBe(p.now());
		expect(p.online.has("device-b")).toBe(false);
		expect(p.facts.logged).toEqual([
			{
				fact: {
					type: "DeviceRevoked",
					payload: { deviceId: "device-b" },
					spaceId: "personal-person-ada",
				},
				withRows: true,
			},
			{
				fact: {
					type: "DeviceOffline",
					payload: { deviceId: "device-b" },
					spaceId: "personal-person-ada",
				},
				withRows: false,
			},
		]);
	});

	test("a revoked Device changes nothing; an unknown one is refused", async () => {
		const p = await ports();
		await revokeDevice(p)({ id: "device-b" });
		await revokeDevice(p)({ id: "device-b" });
		expect(p.facts.logged).toHaveLength(1);
		const refused = revokeDevice(p)({ id: "nobody" });
		await expect(refused).rejects.toBeInstanceOf(Refusal);
		await expect(refused).rejects.toThrow(
			"This device is not paired with this computer.",
		);
	});
});
