import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Profile } from "@nightshift/flows";
import { openDeviceDocument } from "../device-config/device-document";
import { createProfileStore } from "../device-config/profiles";
import { createSandbox, type Sandbox } from "../testing/test-support";
import { createFlowMigrations } from "./flow-migration";

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

const triage: Profile = { name: "triage", decider: "openrouter" };

/** Another Device's document in this Replica, with its name and profiles. */
async function otherDevice(
	deviceId: string,
	name: string,
	profiles: Profile[],
): Promise<string[]> {
	const document = await openDeviceDocument({ db: sandbox.db, deviceId });
	await document.change(() => document.facts.set("name", name));
	const store = createProfileStore({ document });
	const ids: string[] = [];
	for (const profile of profiles) ids.push((await store.save(profile)).id);
	await document.close();
	return ids;
}

test("finds a profile of this Device by its name, also one renamed after ids came", async () => {
	const document = await sandbox.openDocument();
	const store = createProfileStore({ document });
	// An old profile keeps its name as its id; a rename changes only its name.
	await store.save({ ...triage, name: "maker" }, "builder");
	const fresh = await store.save({ ...triage, name: "builder" });
	const migrations = createFlowMigrations({
		db: sandbox.db,
		device: async () => ({ id: sandbox.deviceId, name: "MacBook" }),
		profiles: store,
	});
	const migration = await migrations.forDevice(sandbox.deviceId);
	expect(migration.deviceId).toBe(sandbox.deviceId);
	expect(migration.profileIdByName(sandbox.deviceId, "builder")).toBe(fresh.id);
	expect(migration.profileIdByName(sandbox.deviceId, "maker")).toBe("builder");
	expect(migration.deviceIdByName("MacBook")).toBe(sandbox.deviceId);
	await document.close();
});

test("finds another Device and its profiles from the Device documents this Replica keeps", async () => {
	const [triageId] = await otherDevice("le-2316", "LE2316", [triage]);
	const migrations = createFlowMigrations({
		db: sandbox.db,
		device: async () => ({ id: sandbox.deviceId, name: "MacBook" }),
	});
	const migration = await migrations.forDevice("le-2316");
	expect(migration.deviceId).toBe("le-2316");
	expect(migration.deviceIdByName("LE2316")).toBe("le-2316");
	expect(migration.profileIdByName("le-2316", "triage")).toBe(triageId ?? "");
	expect(migration.profileIdByName("le-2316", "builder")).toBeNull();
	expect(migration.deviceIdByName("hetzner-1")).toBeNull();
});

test("two Devices of one name find nothing: Night Shift does not guess", async () => {
	await otherDevice("twin-1", "twin", [triage]);
	await otherDevice("twin-2", "twin", [triage]);
	const migrations = createFlowMigrations({
		db: sandbox.db,
		device: async () => ({ id: sandbox.deviceId, name: "MacBook" }),
	});
	const migration = await migrations.forDevice(sandbox.deviceId);
	expect(migration.deviceIdByName("twin")).toBeNull();
});

describe("a Device's name in a Space (ADR 14)", () => {
	/** The Device rows of a Host: three Persons, two Macs named alike. */
	const rows = [
		{ id: "ada-mac", name: "MacBook", ownerId: "ada" },
		{ id: "bob-mac", name: "MacBook", ownerId: "bob" },
		{ id: "ada-desk", name: "LE2316", ownerId: "ada" },
		{ id: "ada-dev", name: "LE2316", ownerId: "ada" },
		{ id: "zed-box", name: "hetzner-1", ownerId: "zed" },
		{ id: "zed-far", name: "far", ownerId: "zed" },
	];
	/** The Space document: its Devices with a Clone, and one Offer. */
	const space = {
		devices: new Map<string, unknown>([
			["ada-mac", { name: "MacBook", updatedAt: 1 }],
			["bob-mac", { name: "MacBook", updatedAt: 1 }],
			["ada-desk", { name: "LE2316", updatedAt: 1 }],
			["ada-dev", { name: "LE2316", updatedAt: 1 }],
		]),
		offers: new Map<string, unknown>([
			["zed-box/p", { deviceId: "zed-box", deviceName: "hetzner-1" }],
		]),
	};
	const migrationsFor = (selfOwner: string | null = "ada") =>
		createFlowMigrations({
			db: sandbox.db,
			device: async () => ({ id: sandbox.deviceId, name: "Host" }),
			directory: {
				known: async () => rows,
				selfOwnerId: async () => selfOwner,
			},
			spaces: { open: async () => space } as never,
		});

	test("the Person's own Device of that name wins over another Person's", async () => {
		const migrations = migrationsFor();
		const forAda = await migrations.forDevice(sandbox.deviceId, {
			spaceId: "s",
			personId: "ada",
		});
		const forBob = await migrations.forDevice(sandbox.deviceId, {
			spaceId: "s",
			personId: "bob",
		});
		expect(forAda.deviceIdByName("MacBook")).toBe("ada-mac");
		expect(forBob.deviceIdByName("MacBook")).toBe("bob-mac");
	});

	test("two Devices of one name in the first rank that has it find nothing: Night Shift does not guess", async () => {
		const migrations = migrationsFor();
		const forAda = await migrations.forDevice(sandbox.deviceId, {
			spaceId: "s",
			personId: "ada",
		});
		// Ada's desktop app and her development daemon.
		expect(forAda.deviceIdByName("LE2316")).toBeNull();
		const forCarol = await migrations.forDevice(sandbox.deviceId, {
			spaceId: "s",
			personId: "carol",
		});
		expect(forCarol.deviceIdByName("MacBook")).toBeNull();
	});

	test("another Person's Device counts only when the Space has it", async () => {
		const forAda = await migrationsFor().forDevice(sandbox.deviceId, {
			spaceId: "s",
			personId: "ada",
		});
		expect(forAda.deviceIdByName("hetzner-1")).toBe("zed-box");
		expect(forAda.deviceIdByName("far")).toBeNull();
		expect(forAda.deviceIdByName("Host")).toBe(sandbox.deviceId);
	});

	test("without a Person, this computer's owner's Devices come first", async () => {
		const forOwner = await migrationsFor("bob").forDevice(sandbox.deviceId, {
			spaceId: "s",
		});
		expect(forOwner.deviceIdByName("MacBook")).toBe("bob-mac");
	});
});
