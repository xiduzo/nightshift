import { describe, expect, test } from "bun:test";
import { inMemoryRegistryPorts } from "../adapters/out/in-memory-neighbours";
import { listKnownDevices } from "./list-known-devices";

/** The use case listKnownDevices, on in-memory adapters. */

describe("listKnownDevices", () => {
	test("every Device whose access is not removed, with its owner", async () => {
		const p = inMemoryRegistryPorts();
		p.store.add({ id: "self", self: true, name: "studio", ownerId: "ada" });
		p.store.add({ id: "b", name: "MacBook", ownerId: "ada" });
		p.store.add({ id: "gone", revokedAt: 1 });
		expect(await listKnownDevices(p)()).toEqual([
			{ id: "self", name: "studio", ownerId: "ada" },
			{ id: "b", name: "MacBook", ownerId: "ada" },
		]);
	});
});
