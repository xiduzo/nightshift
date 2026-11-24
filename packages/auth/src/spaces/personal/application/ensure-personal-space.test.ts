import { describe, expect, test } from "bun:test";
import { personalPorts } from "../test-support";
import { ensurePersonalSpace } from "./ensure-personal-space";

async function withAda() {
	const ports = await personalPorts();
	await ports.person({
		id: "ada",
		name: "Ada",
		email: "a@x.org",
		role: "user",
	});
	return ports;
}

describe("ensurePersonalSpace", () => {
	test("makes the personal Space with its owner membership when there is none", async () => {
		const ports = await withAda();
		expect(await ensurePersonalSpace(ports)({ personId: "ada" })).toBe("id-1");
		expect(await ports.spaces()).toEqual([
			{ id: "id-1", name: "Personal", slug: "personal-ada", personal: true },
		]);
		expect(await ports.members()).toEqual([
			{ id: "id-2", spaceId: "id-1", personId: "ada", role: "owner" },
		]);
	});

	test("keeps the one there is", async () => {
		const ports = await withAda();
		const ensure = ensurePersonalSpace(ports);
		const first = await ensure({ personId: "ada" });
		expect(await ensure({ personId: "ada" })).toBe(first);
		expect(await ports.spaces()).toHaveLength(1);
	});

	test("is made with its owner membership, or not at all", async () => {
		const ports = await personalPorts();
		const made = ensurePersonalSpace(ports)({ personId: "nobody" });
		expect(await made.then(() => true).catch(() => false)).toBe(false);
		expect(await ports.spaces()).toEqual([]);
	});
});
