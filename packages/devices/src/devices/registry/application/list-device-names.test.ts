import { describe, expect, test } from "bun:test";
import { registryPorts } from "../test-support";
import { listDeviceNames } from "./list-device-names";

/** The use case listDeviceNames, over a database in memory. */

describe("listDeviceNames", () => {
	test("the names by id, this computer's too; an unknown one is missing", async () => {
		const p = await registryPorts();
		await p.add({ id: "self", self: true, name: "studio" });
		await p.add({ id: "b", name: "MacBook" });
		expect(await listDeviceNames(p)({ ids: ["self", "b", "nobody"] })).toEqual(
			new Map([
				["self", "studio"],
				["b", "MacBook"],
			]),
		);
	});

	test("no ids, no names", async () => {
		expect(await listDeviceNames(await registryPorts())({ ids: [] })).toEqual(
			new Map(),
		);
	});
});
