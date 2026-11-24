import { describe, expect, test } from "bun:test";
import { registryPorts } from "../test-support";
import { setSelfOwner } from "./set-self-owner";

/** The use case setSelfOwner, over a database in memory. */

describe("setSelfOwner", () => {
	test("names the owner of this computer's Device", async () => {
		const p = await registryPorts();
		await p.add({ id: "self", self: true });
		await setSelfOwner(p)({ personId: "person-ada" });
		expect((await p.store.self())?.ownerId).toBe("person-ada");
	});

	test("throws when this computer has no Device row yet", async () => {
		const p = await registryPorts();
		await expect(setSelfOwner(p)({ personId: "person-ada" })).rejects.toThrow(
			"This computer has no Device row yet.",
		);
	});
});
