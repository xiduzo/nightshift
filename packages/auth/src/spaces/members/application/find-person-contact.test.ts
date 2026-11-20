import { describe, expect, test } from "bun:test";
import { inMemoryMembersPorts } from "../adapters/out/in-memory-neighbours";
import { findPersonContact } from "./find-person-contact";

describe("findPersonContact", () => {
	test("gives the name and email of a Person this Replica knows, else null", async () => {
		const ports = inMemoryMembersPorts();
		await ports.seed.person({ id: "ada", name: "Ada", email: "a@x.org" });
		expect(await findPersonContact(ports)({ personId: "ada" })).toEqual({
			name: "Ada",
			email: "a@x.org",
		});
		expect(await findPersonContact(ports)({ personId: "bo" })).toBeNull();
	});
});
