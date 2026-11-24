import { describe, expect, test } from "bun:test";
import { registryPorts } from "../test-support";
import { listDevices } from "./list-devices";

/** The use case listDevices, over a database in memory. */

describe("listDevices", () => {
	test("the Person's paired Devices, revoked ones last, then the newest first", async () => {
		const ports = await registryPorts();
		const ada = "person-ada";
		await ports.add({ id: "first", ownerId: ada, createdAt: 1 });
		await ports.add({ id: "gone", ownerId: ada, createdAt: 3, revokedAt: 4 });
		await ports.add({ id: "second", ownerId: ada, createdAt: 2 });
		await ports.add({ id: "bo", ownerId: "person-bo", createdAt: 5 });
		await ports.add({ id: "self", ownerId: ada, self: true });
		const listed = await listDevices(ports)({ ownerId: ada });
		expect(listed.map((d) => d.id)).toEqual(["second", "first", "gone"]);
	});
});
