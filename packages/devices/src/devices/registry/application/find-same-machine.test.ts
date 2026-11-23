import { describe, expect, test } from "bun:test";
import { inMemoryRegistryPorts } from "../adapters/out/in-memory-neighbours";
import { findSameMachine } from "./find-same-machine";

/** The use case findSameMachine, on in-memory adapters. */

const ada = "person-ada";

function ports() {
	const ports = inMemoryRegistryPorts();
	ports.store.add({ id: "old", ownerId: ada, machine: "m", lastSeenAt: 10 });
	ports.store.add({ id: "asks", ownerId: ada, machine: "m", lastSeenAt: 30 });
	return ports;
}

describe("findSameMachine", () => {
	test("finds the Device of the same owner on the same computer", async () => {
		const found = await findSameMachine(ports())({
			ownerId: ada,
			machine: "m",
			exceptId: "asks",
		});
		expect(found?.id).toBe("old");
	});

	test("never finds the Device that asks", async () => {
		const p = ports();
		p.store.rows.delete("old");
		expect(
			await findSameMachine(p)({
				ownerId: ada,
				machine: "m",
				exceptId: "asks",
			}),
		).toBeNull();
	});

	test("finds a removed Device, so pairing again brings it back", async () => {
		const p = ports();
		p.store.add({ id: "old", ownerId: ada, machine: "m", revokedAt: 5 });
		const found = await findSameMachine(p)({
			ownerId: ada,
			machine: "m",
			exceptId: "asks",
		});
		expect(found).toMatchObject({ id: "old", revokedAt: 5 });
	});

	test("prefers the Device with access over a removed one", async () => {
		const p = ports();
		p.store.add({
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
		const p = inMemoryRegistryPorts();
		p.store.add({ id: "self", ownerId: ada, machine: "m", self: true });
		p.store.add({ id: "dev", ownerId: ada, machine: "m", dev: true });
		p.store.add({ id: "bo", ownerId: "person-bo", machine: "m" });
		expect(
			await findSameMachine(p)({
				ownerId: ada,
				machine: "m",
				exceptId: "asks",
			}),
		).toBeNull();
	});
});
