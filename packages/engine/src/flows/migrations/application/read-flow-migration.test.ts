import { describe, expect, test } from "bun:test";
import { inMemoryMigrationsPorts } from "../adapters/out/in-memory-neighbours";
import { readFlowMigration } from "./read-flow-migration";

describe("readFlowMigration", () => {
	test("finds a profile of this Device by its name, also one renamed after ids came", async () => {
		const ports = inMemoryMigrationsPorts();
		await ports.profiles.save({ name: "maker", decider: "ollama" }, "builder");
		await ports.profiles.save({ name: "builder", decider: "ollama" }, "fresh");
		const migration = await readFlowMigration(ports)({ deviceId: "laptop" });
		expect(migration.deviceId).toBe("laptop");
		expect(migration.profileIdByName("laptop", "builder")).toBe("fresh");
		expect(migration.profileIdByName("laptop", "maker")).toBe("builder");
		expect(migration.deviceIdByName("MacBook")).toBe("laptop");
	});

	test("finds another Device and its profiles from the Device documents this Replica keeps", async () => {
		const ports = inMemoryMigrationsPorts();
		ports.stored.devices = [
			{
				deviceId: "le-2316",
				name: "LE2316",
				profiles: [{ id: "t1", name: "triage" }],
			},
		];
		const migration = await readFlowMigration(ports)({ deviceId: "le-2316" });
		expect(migration.deviceIdByName("LE2316")).toBe("le-2316");
		expect(migration.profileIdByName("le-2316", "triage")).toBe("t1");
		expect(migration.profileIdByName("le-2316", "builder")).toBeNull();
		expect(migration.deviceIdByName("hetzner-1")).toBeNull();
	});

	test("two Devices of one name find nothing: Night Shift does not guess", async () => {
		const ports = inMemoryMigrationsPorts();
		ports.stored.devices = [
			{ deviceId: "twin-1", name: "twin", profiles: [] },
			{ deviceId: "twin-2", name: "twin", profiles: [] },
		];
		const migration = await readFlowMigration(ports)({ deviceId: "laptop" });
		expect(migration.deviceIdByName("twin")).toBeNull();
	});

	describe("a Device's name in a Space (ADR 14)", () => {
		/** A Host: three Persons, two Macs named alike, and one Offer in the Space. */
		function onHost(owner: string | null = "ada") {
			const ports = inMemoryMigrationsPorts();
			ports.directory.rows = [
				{ id: "ada-mac", name: "MacBook", ownerId: "ada" },
				{ id: "bob-mac", name: "MacBook", ownerId: "bob" },
				{ id: "ada-desk", name: "LE2316", ownerId: "ada" },
				{ id: "ada-dev", name: "LE2316", ownerId: "ada" },
				{ id: "zed-box", name: "hetzner-1", ownerId: "zed" },
				{ id: "zed-far", name: "far", ownerId: "zed" },
			];
			ports.directory.owner = owner;
			ports.spaces.spaces.s = {
				devices: {
					"ada-mac": { name: "MacBook", updatedAt: 1 },
					"bob-mac": { name: "MacBook", updatedAt: 1 },
					"ada-desk": { name: "LE2316", updatedAt: 1 },
					"ada-dev": { name: "LE2316", updatedAt: 1 },
				},
				offers: [{ deviceId: "zed-box", deviceName: "hetzner-1" }],
			};
			return {
				...ports,
				device: { device: async () => ({ id: "host", name: "Host" }) },
			};
		}

		test("the Person's own Device of that name wins over another Person's", async () => {
			const read = readFlowMigration(onHost());
			const forAda = await read({
				deviceId: "host",
				scope: { spaceId: "s", personId: "ada" },
			});
			const forBob = await read({
				deviceId: "host",
				scope: { spaceId: "s", personId: "bob" },
			});
			expect(forAda.deviceIdByName("MacBook")).toBe("ada-mac");
			expect(forBob.deviceIdByName("MacBook")).toBe("bob-mac");
		});

		test("two Devices of one name in the first rank that has it find nothing: Night Shift does not guess", async () => {
			const read = readFlowMigration(onHost());
			const forAda = await read({
				deviceId: "host",
				scope: { spaceId: "s", personId: "ada" },
			});
			expect(forAda.deviceIdByName("LE2316")).toBeNull();
			const forCarol = await read({
				deviceId: "host",
				scope: { spaceId: "s", personId: "carol" },
			});
			expect(forCarol.deviceIdByName("MacBook")).toBeNull();
		});

		test("another Person's Device counts only when the Space has it", async () => {
			const forAda = await readFlowMigration(onHost())({
				deviceId: "host",
				scope: { spaceId: "s", personId: "ada" },
			});
			expect(forAda.deviceIdByName("hetzner-1")).toBe("zed-box");
			expect(forAda.deviceIdByName("far")).toBeNull();
			expect(forAda.deviceIdByName("Host")).toBe("host");
		});

		test("without a Person, this computer's owner's Devices come first", async () => {
			const ports = onHost("bob");
			const forOwner = await readFlowMigration(ports)({
				deviceId: "host",
				scope: { spaceId: "s" },
			});
			expect(forOwner.deviceIdByName("MacBook")).toBe("bob-mac");
			expect(ports.directory.ownerAsked).toBe(1);
		});

		test("with a Person, the owner of this computer is not asked", async () => {
			const ports = onHost();
			await readFlowMigration(ports)({
				deviceId: "host",
				scope: { spaceId: "s", personId: "ada" },
			});
			expect(ports.directory.ownerAsked).toBe(0);
		});
	});
});
