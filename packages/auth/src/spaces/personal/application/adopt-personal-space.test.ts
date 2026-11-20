import { describe, expect, test } from "bun:test";
import { inMemoryPersonalPorts } from "../adapters/out/in-memory-neighbours";
import { applyRows } from "../adapters/out/in-memory-personal-space-store";
import { adoptPersonalSpace } from "./adopt-personal-space";

async function withSpaces() {
	const ports = inMemoryPersonalPorts();
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
		membershipId: "m-mine",
	});
	ports.records.spaces.push({
		id: "host",
		name: "Ada's",
		slug: "host-host",
		personal: false,
	});
	return ports;
}

const refusalOf = (work: Promise<unknown>) =>
	work.then(
		() => null,
		(error: Error) => error.message,
	);

describe("adoptPersonalSpace", () => {
	test("the Host's Space becomes the one personal Space, named Personal", async () => {
		const ports = await withSpaces();
		const rows = await adoptPersonalSpace(ports)({
			personId: "ada",
			from: "mine",
			to: "host",
		});
		applyRows(ports.records, rows);
		expect(ports.records.spaces).toEqual([
			{ id: "host", name: "Personal", slug: "host-host", personal: true },
		]);
		expect(ports.records.members).toEqual([
			{ id: "id-1", spaceId: "host", personId: "ada", role: "owner" },
		]);
	});

	test("only the Person's own personal Space can be adopted, into a Space this Replica has", async () => {
		const ports = await withSpaces();
		const adopt = adoptPersonalSpace(ports);
		expect(
			await refusalOf(adopt({ personId: "ada", from: "host", to: "mine" })),
		).toBe("The Space host is not the personal Space of ada.");
		expect(
			await refusalOf(adopt({ personId: "ada", from: "mine", to: "mine" })),
		).toBe("A Space cannot take its own place.");
		expect(
			await refusalOf(adopt({ personId: "ada", from: "mine", to: "gone" })),
		).toBe("The Space gone is not on this Replica.");
	});
});
