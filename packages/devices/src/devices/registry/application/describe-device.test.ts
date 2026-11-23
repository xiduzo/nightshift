import { describe, expect, test } from "bun:test";
import { inMemoryRegistryPorts } from "../adapters/out/in-memory-neighbours";
import { describeDevice } from "./describe-device";

/** The use case describeDevice, on in-memory adapters. */

describe("describeDevice", () => {
	test("a Device that links says its computer", async () => {
		const ports = inMemoryRegistryPorts();
		ports.store.add({ id: "device-b" });
		await describeDevice(ports)({
			id: "device-b",
			name: "Air",
			dev: false,
			machine: "m-1",
		});
		expect(await ports.store.paired("device-b")).toMatchObject({
			name: "Air",
			dev: false,
			machine: "m-1",
		});
	});

	test("a Device that says nothing keeps its computer", async () => {
		const ports = inMemoryRegistryPorts();
		ports.store.add({ id: "device-b", machine: "m-1" });
		await describeDevice(ports)({ id: "device-b", name: "Air", dev: false });
		expect((await ports.store.paired("device-b"))?.machine).toBe("m-1");
	});

	test("a development install is never the computer", async () => {
		const ports = inMemoryRegistryPorts();
		ports.store.add({ id: "device-b", machine: "m-1" });
		await describeDevice(ports)({
			id: "device-b",
			name: "Air",
			dev: true,
			machine: "m-2",
		});
		expect(await ports.store.paired("device-b")).toMatchObject({
			dev: true,
			machine: null,
		});
	});
});
