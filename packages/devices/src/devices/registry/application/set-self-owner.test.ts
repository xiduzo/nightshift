import { describe, expect, test } from "bun:test";
import { inMemoryRegistryPorts } from "../adapters/out/in-memory-neighbours";
import { setSelfOwner } from "./set-self-owner";

/** The use case setSelfOwner, on in-memory adapters. */

describe("setSelfOwner", () => {
	test("names the owner of this computer's Device", async () => {
		const p = inMemoryRegistryPorts();
		p.store.add({ id: "self", self: true });
		await setSelfOwner(p)({ personId: "person-ada" });
		expect((await p.store.self())?.ownerId).toBe("person-ada");
	});

	test("throws when this computer has no Device row yet", async () => {
		const p = inMemoryRegistryPorts();
		await expect(setSelfOwner(p)({ personId: "person-ada" })).rejects.toThrow(
			"This computer has no Device row yet.",
		);
	});
});
