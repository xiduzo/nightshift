import { describe, expect, test } from "bun:test";
import { inMemoryPersonalPorts } from "../adapters/out/in-memory-neighbours";
import { ensurePersonalSpace } from "./ensure-personal-space";

function withAda() {
	const ports = inMemoryPersonalPorts();
	ports.records.persons.push({
		id: "ada",
		name: "Ada",
		email: "a@x.org",
		role: "user",
	});
	return ports;
}

describe("ensurePersonalSpace", () => {
	test("makes the personal Space with its owner membership when there is none", async () => {
		const ports = withAda();
		expect(await ensurePersonalSpace(ports)({ personId: "ada" })).toBe("id-1");
		expect(ports.records.spaces).toEqual([
			{ id: "id-1", name: "Personal", slug: "personal-ada", personal: true },
		]);
		expect(ports.records.members).toEqual([
			{ id: "id-2", spaceId: "id-1", personId: "ada", role: "owner" },
		]);
	});

	test("keeps the one there is", async () => {
		const ports = withAda();
		const ensure = ensurePersonalSpace(ports);
		const first = await ensure({ personId: "ada" });
		expect(await ensure({ personId: "ada" })).toBe(first);
		expect(ports.records.spaces).toHaveLength(1);
	});

	test("is made with its owner membership, or not at all", async () => {
		const ports = inMemoryPersonalPorts();
		const made = ensurePersonalSpace(ports)({ personId: "nobody" });
		expect(await made.then(() => true).catch(() => false)).toBe(false);
		expect(ports.records.spaces).toEqual([]);
	});
});
