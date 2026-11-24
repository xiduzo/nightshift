import { describe, expect, test } from "bun:test";
import { registryPorts } from "../test-support";
import { markDeviceSeen } from "./mark-device-seen";

/** The use case markDeviceSeen, over a database in memory. */

async function ports() {
	const ports = await registryPorts();
	ports.spaces.add("person-ada");
	await ports.add({ id: "device-b", ownerId: "person-ada" });
	return ports;
}

describe("markDeviceSeen", () => {
	test("online while the link answers: DeviceOnline once, last seen each time", async () => {
		const p = await ports();
		const seen = markDeviceSeen(p);
		await seen({ id: "device-b" });
		p.later(1_000);
		await seen({ id: "device-b" });
		expect(p.facts.logged.map((l) => l.fact)).toEqual([
			{
				type: "DeviceOnline",
				payload: { deviceId: "device-b" },
				spaceId: "personal-person-ada",
			},
		]);
		expect(p.online.get("device-b")).toBe(p.now());
		expect((await p.store.paired("device-b"))?.lastSeenAt).toBe(p.now());
	});

	test("a Device this Host has no paired row of stays offline", async () => {
		const p = await ports();
		await markDeviceSeen(p)({ id: "nobody" });
		expect(p.online.has("nobody")).toBe(false);
		expect(p.facts.logged).toEqual([]);
	});
});
