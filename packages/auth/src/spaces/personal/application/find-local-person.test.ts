import { describe, expect, test } from "bun:test";
import { inMemoryPersonalPorts } from "../adapters/out/in-memory-neighbours";
import { findLocalPerson } from "./find-local-person";

function owned(ownerId: string | null) {
	const named: string[] = [];
	return {
		named,
		self: {
			ownerId,
			setOwner: async (personId: string) => {
				named.push(personId);
			},
		},
	};
}

function localPorts() {
	const ports = inMemoryPersonalPorts();
	return {
		...ports,
		ensurePersonalSpace: async (request: { personId: string }) =>
			`personal-of-${request.personId}`,
	};
}

describe("findLocalPerson", () => {
	test("a database without one gets a new Person, named after the account, who may be the Host admin", async () => {
		const ports = localPorts();
		const device = owned(null);
		expect(await findLocalPerson(ports)({ self: device.self })).toEqual({
			userId: "id-1",
			spaceId: "personal-of-id-1",
		});
		expect(ports.records.persons).toEqual([
			{
				id: "id-1",
				name: "ada",
				email: "local@nightshift.invalid",
				role: "user",
			},
		]);
		expect(ports.claimed).toEqual(["id-1"]);
		expect(device.named).toEqual(["id-1"]);
	});

	test("is the owner the Device names, and a blank name becomes the account's", async () => {
		const ports = localPorts();
		ports.records.persons.push({
			id: "bo",
			name: " ",
			email: "b@x.org",
			role: "user",
		});
		const device = owned("bo");
		expect((await findLocalPerson(ports)({ self: device.self })).userId).toBe(
			"bo",
		);
		expect(ports.records.persons[0]?.name).toBe("ada");
		expect(device.named).toEqual([]);
		expect(ports.claimed).toEqual([]);
	});

	test("a Device whose owner is gone takes the Person with the local email", async () => {
		const ports = localPorts();
		ports.records.persons.push({
			id: "local",
			name: "Cy",
			email: "local@nightshift.invalid",
			role: "admin",
		});
		const device = owned("gone");
		expect((await findLocalPerson(ports)({ self: device.self })).userId).toBe(
			"local",
		);
		expect(device.named).toEqual(["local"]);
		expect(ports.records.persons[0]?.name).toBe("Cy");
	});
});
