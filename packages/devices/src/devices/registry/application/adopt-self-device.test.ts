import { describe, expect, test } from "bun:test";
import { inMemoryRegistryPorts } from "../adapters/out/in-memory-neighbours";
import { adoptSelfDevice } from "./adopt-self-device";

/** The use case adoptSelfDevice, on in-memory adapters. */

function ports() {
	const p = inMemoryRegistryPorts();
	p.store.add({
		id: "old",
		self: true,
		name: "studio",
		platform: "linux",
		ownerId: "person-ada",
	});
	return p;
}

describe("adoptSelfDevice", () => {
	test("this install becomes the Device, and its name and owner stay", async () => {
		const p = ports();
		await adoptSelfDevice(p)({ deviceId: "new" });
		expect(await p.store.self()).toMatchObject({
			id: "new",
			name: "studio",
			ownerId: "person-ada",
		});
		expect(p.store.rows.has("old")).toBe(false);
		expect(p.engineRows.ran).toEqual(["adopt old new"]);
		expect(p.engineRows.adopts).toEqual([
			{ from: "old", to: "new", lastSeq: 0, joined: null },
		]);
	});

	test("its events count on after the last the Host has: the place is held by DeviceJoined", async () => {
		const p = ports();
		p.spaces.add("person-ada");
		await adoptSelfDevice(p)({ deviceId: "new", lastSeq: 7 });
		expect(p.engineRows.adopts[0]).toEqual({
			from: "old",
			to: "new",
			lastSeq: 7,
			joined: {
				type: "DeviceJoined",
				spaceId: "personal-person-ada",
				payload: {
					deviceId: "new",
					name: "studio",
					platform: "linux",
					ownerId: "person-ada",
					home: true,
				},
			},
		});
	});

	test("a count to hold without a personal Space is an error, and nothing moves", async () => {
		const p = ports();
		await expect(
			adoptSelfDevice(p)({ deviceId: "new", lastSeq: 7 }),
		).rejects.toThrow("This computer has no personal Space yet.");
		expect(p.engineRows.ran).toEqual([]);
	});

	test("the same id changes nothing", async () => {
		const p = ports();
		await adoptSelfDevice(p)({ deviceId: "old" });
		expect(p.engineRows.adopts).toEqual([]);
	});

	test("without a row of its own it throws", async () => {
		const p = inMemoryRegistryPorts();
		await expect(adoptSelfDevice(p)({ deviceId: "new" })).rejects.toThrow(
			"This computer has no Device row yet.",
		);
	});
});
