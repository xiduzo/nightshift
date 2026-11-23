import { describe, expect, test } from "bun:test";
import { inMemoryRegistryPorts } from "../adapters/out/in-memory-neighbours";
import { findDevice } from "./find-device";

/** The use case findDevice, on in-memory adapters. */

describe("findDevice", () => {
	test("a paired Device, online while its presence says so", async () => {
		const ports = inMemoryRegistryPorts();
		ports.store.add({ id: "device-b", ownerId: "person-ada", dev: true });
		ports.online.set("device-b", 1);
		expect(await findDevice(ports)({ id: "device-b" })).toMatchObject({
			id: "device-b",
			dev: true,
			ownerId: "person-ada",
			online: true,
		});
	});

	test("never this computer's own row, nor an unknown one", async () => {
		const ports = inMemoryRegistryPorts();
		ports.store.add({ id: "self", self: true });
		expect(await findDevice(ports)({ id: "self" })).toBeNull();
		expect(await findDevice(ports)({ id: "nobody" })).toBeNull();
	});
});
