import { describe, expect, test } from "bun:test";
import { inMemoryRegistryPorts } from "../adapters/out/in-memory-neighbours";
import { listDeviceNames } from "./list-device-names";

/** The use case listDeviceNames, on in-memory adapters. */

describe("listDeviceNames", () => {
	test("the names by id, this computer's too; an unknown one is missing", async () => {
		const p = inMemoryRegistryPorts();
		p.store.add({ id: "self", self: true, name: "studio" });
		p.store.add({ id: "b", name: "MacBook" });
		expect(await listDeviceNames(p)({ ids: ["self", "b", "nobody"] })).toEqual(
			new Map([
				["self", "studio"],
				["b", "MacBook"],
			]),
		);
	});

	test("no ids, no names", async () => {
		expect(await listDeviceNames(inMemoryRegistryPorts())({ ids: [] })).toEqual(
			new Map(),
		);
	});
});
