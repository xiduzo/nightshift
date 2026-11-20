import { describe, expect, test } from "bun:test";
import { inMemoryPersonalPorts } from "../adapters/out/in-memory-neighbours";
import { findPersonalSpace } from "./find-personal-space";

describe("findPersonalSpace", () => {
	test("finds the personal Space the Person is a member of, or null", async () => {
		const ports = inMemoryPersonalPorts();
		expect(await findPersonalSpace(ports)({ personId: "ada" })).toBeNull();
		ports.records.persons.push({
			id: "ada",
			name: "Ada",
			email: "a@x.org",
			role: "user",
		});
		await ports.personalSpaceStore.create({
			id: "mine",
			name: "Personal",
			slug: "personal-ada",
			personId: "ada",
			membershipId: "m-1",
		});
		expect(await findPersonalSpace(ports)({ personId: "ada" })).toBe("mine");
	});
});
