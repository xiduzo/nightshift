import { describe, expect, test } from "bun:test";
import { registryPorts } from "../test-support";
import { findSameMachine } from "./find-same-machine";

/** The use case findSameMachine, over a database in memory. */

const ada = "person-ada";

async function ports() {
	const ports = await registryPorts();
	await ports.add({ id: "old", ownerId: ada, machine: "m", lastSeenAt: 10 });
	await ports.add({ id: "asks", ownerId: ada, machine: "m", lastSeenAt: 30 });
	return ports;
}

describe("findSameMachine", () => {
	test("finds the Device of the same owner on the same computer", async () => {
		const found = await findSameMachine(await ports())({
			ownerId: ada,
			machine: "m",
			exceptId: "asks",
		});
		expect(found?.id).toBe("old");
	});

	test("never finds the Device that asks", async () => {
		const p = await ports();
		await p.remove("old");
		expect(
			await findSameMachine(p)({
				ownerId: ada,
				machine: "m",
				exceptId: "asks",
			}),
		).toBeNull();
	});

	test("finds a removed Device, so pairing again brings it back", async () => {
		const p = await ports();
		await p.add({ id: "old", ownerId: ada, machine: "m", revokedAt: 5 });
		const found = await findSameMachine(p)({
			ownerId: ada,
			machine: "m",
			exceptId: "asks",
		});
		expect(found).toMatchObject({ id: "old", revokedAt: 5 });
	});

	test("prefers the Device with access over a removed one", async () => {
		const p = await ports();
		await p.add({
			id: "gone",
			ownerId: ada,
			machine: "m",
			revokedAt: 5,
			lastSeenAt: 99,
		});
		const found = await findSameMachine(p)({
			ownerId: ada,
			machine: "m",
			exceptId: "asks",
		});
		expect(found?.id).toBe("old");
	});

	test("never finds this Host's own row, a development install or another Person's", async () => {
		const p = await registryPorts();
		await p.add({ id: "self", ownerId: ada, machine: "m", self: true });
		await p.add({ id: "dev", ownerId: ada, machine: "m", dev: true });
		await p.add({ id: "bo", ownerId: "person-bo", machine: "m" });
		expect(
			await findSameMachine(p)({
				ownerId: ada,
				machine: "m",
				exceptId: "asks",
			}),
		).toBeNull();
	});
});
