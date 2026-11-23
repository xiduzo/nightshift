import { describe, expect, test } from "bun:test";
import { inMemoryRegistryPorts } from "../adapters/out/in-memory-neighbours";
import { listHomePersons } from "./list-home-persons";

/** The use case listHomePersons, on in-memory adapters. */

describe("listHomePersons", () => {
	test("the owners of the Devices with access that joined this Host as their home", async () => {
		const p = inMemoryRegistryPorts();
		p.store.add({ id: "a1", ownerId: "ada", homeHost: "https://h" });
		p.store.add({ id: "a2", ownerId: "ada", homeHost: "https://h" });
		p.store.add({ id: "guest", ownerId: "bo" });
		p.store.add({
			id: "gone",
			ownerId: "cy",
			homeHost: "https://h",
			revokedAt: 1,
		});
		p.store.add({
			id: "self",
			ownerId: "dee",
			homeHost: "https://h",
			self: true,
		});
		expect(await listHomePersons(p)()).toEqual(["ada"]);
	});
});
