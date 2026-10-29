import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Profile } from "@nightshift/flows";
import { openDeviceDocument } from "../device-config";
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
