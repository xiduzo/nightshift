import { describe, expect, test } from "bun:test";
import { inMemoryRegistryPorts } from "../adapters/out/in-memory-neighbours";
import { readSelfOwner } from "./read-self-owner";

/** The use case readSelfOwner, on in-memory adapters. */

describe("readSelfOwner", () => {
	test("the owner of this computer's Device, or null before one does", async () => {
		const p = inMemoryRegistryPorts();
		expect(await readSelfOwner(p)()).toBeNull();
		p.store.add({ id: "self", self: true });
		expect(await readSelfOwner(p)()).toBeNull();
		p.store.add({ id: "self", self: true, ownerId: "person-ada" });
		expect(await readSelfOwner(p)()).toBe("person-ada");
	});
});
