import { describe, expect, test } from "bun:test";
import { inMemoryRegistryPorts } from "../adapters/out/in-memory-neighbours";
import { listDevices } from "./list-devices";

/** The use case listDevices, on in-memory adapters. */

describe("listDevices", () => {
	test("the Person's paired Devices, revoked ones last, then the newest first", async () => {
		const ports = inMemoryRegistryPorts();
		const ada = "person-ada";
		ports.store.add({ id: "first", ownerId: ada, createdAt: 1 });
		ports.store.add({ id: "gone", ownerId: ada, createdAt: 3, revokedAt: 4 });
		ports.store.add({ id: "second", ownerId: ada, createdAt: 2 });
		ports.store.add({ id: "bo", ownerId: "person-bo", createdAt: 5 });
		ports.store.add({ id: "self", ownerId: ada, self: true });
		const listed = await listDevices(ports)({ ownerId: ada });
		expect(listed.map((d) => d.id)).toEqual(["second", "first", "gone"]);
	});
});
