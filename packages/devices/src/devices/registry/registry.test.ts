import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { device, event, ydoc } from "@nightshift/db/schema";
import {
	createRunBus,
	createRunHistory,
	createRunLog,
	createSandbox,
	deviceRowsOn,
	parseEventRow,
	type Sandbox,
} from "@nightshift/engine/testing";
import { asc, eq } from "drizzle-orm";
import type { DeviceRegistry } from ".";
import { wireRegistry } from "./wire";

let sandbox: Sandbox;
let ownerId: string;
let clock: number;
let registry: DeviceRegistry;

function newRegistry() {
	const log = createRunLog(sandbox.db, {
		walkerId: sandbox.deviceId,
		dataDir: sandbox.dataDir,
	});
	return wireRegistry({ db: sandbox.db }).paired({
		deviceRows: deviceRowsOn(sandbox.db),
		logFact: async (fact, writes) => {
			await log.append(fact, writes);
		},
		history: createRunHistory({
			db: sandbox.db,
			dataDir: sandbox.dataDir,
			log,
			bus: createRunBus(),
		}),
		now: () => clock,
	});
}

beforeEach(async () => {
	sandbox = await createSandbox();
	const [self] = await sandbox.db
		.select({ ownerId: device.ownerId })
		.from(device)
		.where(eq(device.self, true));
	ownerId = self?.ownerId ?? "";
	clock = 1_000_000;
	registry = newRegistry();
});
afterEach(async () => {
	await sandbox.cleanup();
});

const macbook = {
	id: "device-b",
	name: "MacBook",
	platform: "darwin",
	homeHost: "https://studio.example.com",
};

async function deviceEvents() {
	const rows = await sandbox.db.select().from(event).orderBy(asc(event.seq));
	return rows
		.filter((row) => row.type.startsWith("Device"))
		.map((row) => ({ ...parseEventRow(row), spaceId: row.spaceId }));
}

describe("the Devices of a Host", () => {
	test("a Device that pairs gets its row and DeviceJoined, in its owner's personal Space", async () => {
		const joined = await registry.join({ ...macbook, ownerId });
		expect(joined).toMatchObject({
			id: "device-b",
			name: "MacBook",
			platform: "darwin",
			ownerId,
			homeHost: "https://studio.example.com",
			online: false,
			lastSeenAt: null,
			revokedAt: null,
		});
		expect(await deviceEvents()).toMatchObject([
			{
				type: "DeviceJoined",
				spaceId: sandbox.spaceId,
				payload: {
					deviceId: "device-b",
					name: "MacBook",
					ownerId,
					home: true,
				},
			},
		]);
		expect((await registry.list(ownerId)).map((d) => d.id)).toEqual([
			"device-b",
		]);
		expect(await registry.list("someone-else")).toEqual([]);
	});

	test("the Persons of this home Host, and the Devices the engine knows: this computer and each with access, with its owner", async () => {
		await registry.join({ ...macbook, ownerId });
		await registry.join({ ...macbook, id: "device-gone", ownerId });
		await registry.revoke("device-gone");

		expect(await registry.homePersons()).toEqual([ownerId]);
		const known = await wireRegistry({ db: sandbox.db }).listKnownDevices();

		expect(known.map(({ id, ownerId }) => [id, ownerId]).sort()).toEqual(
			[
				["device-b", ownerId],
				[sandbox.deviceId, ownerId],
			].sort(),
		);
	});

	test("revoking ends access: DeviceRevoked, offline, its document no longer kept", async () => {
		await registry.join({ ...macbook, ownerId });
		await registry.seen("device-b");
		expect(await registry.keptDocumentOwner("device:device-b")).toBe(ownerId);

		await registry.revoke("device-b");
		expect(await registry.get("device-b")).toMatchObject({
			online: false,
			revokedAt: clock,
		});
		expect(await registry.keptDocumentOwner("device:device-b")).toBeNull();
		expect((await deviceEvents()).map((e) => e.type)).toEqual([
			"DeviceJoined",
			"DeviceOnline",
			"DeviceRevoked",
			"DeviceOffline",
		]);

		// Pairing again gives access back.
		await registry.join({ ...macbook, ownerId });
		expect((await registry.get("device-b"))?.revokedAt).toBeNull();
	});

	test("forgetting removes a revoked Device for good, its kept document too; never one with access", async () => {
		await registry.join({ ...macbook, ownerId });
		await sandbox.db
			.insert(ydoc)
			.values({ name: "device:device-b", state: Buffer.from([0]) });

		await expect(registry.forget("device-b")).rejects.toThrow(
			"Remove the access of this device first.",
		);
		expect(await registry.get("device-b")).not.toBeNull();

		await registry.revoke("device-b");
		await registry.forget("device-b");
		expect(await registry.get("device-b")).toBeNull();
		expect(await registry.list(ownerId)).toEqual([]);
		expect(
			await sandbox.db
				.select()
				.from(ydoc)
				.where(eq(ydoc.name, "device:device-b")),
		).toEqual([]);
		// Again: nothing left to remove.
		await registry.forget("device-b");
	});

	test("a Host that starts again starts with every Device offline", async () => {
		await registry.join({ ...macbook, ownerId });
		await registry.seen("device-b");

		const again = newRegistry();
		expect((await again.get("device-b"))?.online).toBe(false);
		await again.sweep(45_000);
		expect((await deviceEvents()).map((e) => e.type)).toEqual([
			"DeviceJoined",
			"DeviceOnline",
			"DeviceOffline",
		]);
	});
});

describe("the computer of a Device", () => {
	const FINGERPRINT = "a".repeat(64);
	test("a Device that links says its computer, and two with one computer stay apart", async () => {
		await registry.join({ ...macbook, id: "one", ownerId });
		await registry.join({ ...macbook, id: "two", ownerId });
		expect(
			await registry.sameMachine(ownerId, FINGERPRINT, "new-install"),
		).toBeNull();
		for (const id of ["one", "two"]) {
			await registry.describe(id, {
				name: id,
				dev: false,
				machine: FINGERPRINT,
			});
		}
		expect(await registry.get("one")).not.toBeNull();
		expect(await registry.get("two")).not.toBeNull();
		expect(
			await registry.sameMachine(ownerId, FINGERPRINT, "new-install"),
		).not.toBeNull();
	});
});
