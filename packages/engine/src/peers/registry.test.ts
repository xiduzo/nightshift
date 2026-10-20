import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { device, event } from "@nightshift/db/schema";
import { asc, eq } from "drizzle-orm";

import { parseEventRow } from "../log/events";
import { createRunLog } from "../log/run-log";
import { createSandbox, type Sandbox } from "../testing/test-support";
import { createHostLinks, deviceKeyStore, SECOND_HOME } from "./host-links";
import { createDeviceRegistry, type DeviceRegistry } from "./registry";

let sandbox: Sandbox;
let ownerId: string;
let clock: number;
let registry: DeviceRegistry;

function newRegistry() {
	return createDeviceRegistry({
		db: sandbox.db,
		log: createRunLog(sandbox.db, { walkerId: sandbox.deviceId }),
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

	test("this computer cannot pair with itself", async () => {
		await expect(
			registry.join({ ...macbook, id: sandbox.deviceId, ownerId }),
		).rejects.toThrow(/itself/);
	});

	test("online while the link answers; offline after a silence", async () => {
		await registry.join({ ...macbook, ownerId });
		await registry.seen("device-b");
		clock += 15_000;
		await registry.seen("device-b");
		expect(await registry.get("device-b")).toMatchObject({
			online: true,
			lastSeenAt: clock,
		});

		clock += 30_000;
		await registry.sweep(45_000);
		expect((await registry.get("device-b"))?.online).toBe(true);
		clock += 16_000;
		await registry.sweep(45_000);
		expect((await registry.get("device-b"))?.online).toBe(false);

		expect((await deviceEvents()).map((e) => e.type)).toEqual([
			"DeviceJoined",
			"DeviceOnline",
			"DeviceOffline",
		]);
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

	test("a guest Host keeps no Device document; nor does any Host for a name it does not know", async () => {
		await registry.join({ ...macbook, homeHost: null, ownerId });
		expect(await registry.keptDocumentOwner("device:device-b")).toBeNull();
		expect(await registry.keptDocumentOwner("device:unknown")).toBeNull();
		expect(
			await registry.keptDocumentOwner(`device:${sandbox.deviceId}`),
		).toBeNull();
		expect(await registry.keptDocumentOwner("space:device-b")).toBeNull();
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

describe("the links of a joining Device", () => {
	const link = {
		hostId: "host-a",
		name: "studio",
		addresses: ["https://studio.local", "https://studio.example.com"],
		certificate: null,
		fingerprint: null,
		role: "home" as const,
		personId: "person-a",
		keyStore: "file" as const,
	};

	test("a home link sets this Device's home Host; a second home is refused", async () => {
		const links = createHostLinks(sandbox.db);
		await links.save(link);
		const [self] = await sandbox.db
			.select({ homeHost: device.homeHost })
			.from(device)
			.where(eq(device.self, true));
		expect(self?.homeHost).toBe("https://studio.local");

		await expect(
			links.save({ ...link, hostId: "host-c", name: "other" }),
		).rejects.toThrow(SECOND_HOME);
		await links.save({ ...link, hostId: "host-c", role: "guest" });
		expect((await links.list()).map((l) => [l.hostId, l.role])).toEqual([
			["host-c", "guest"],
			["host-a", "home"],
		]);
	});

	test("a revoked home can be replaced, and the Device has no home meanwhile", async () => {
		const links = createHostLinks(sandbox.db);
		await links.save(link);
		await links.revoked("host-a");
		expect((await links.get("host-a"))?.revokedAt).not.toBeNull();
		const homeHost = async () =>
			(
				await sandbox.db
					.select({ homeHost: device.homeHost })
					.from(device)
					.where(eq(device.self, true))
			)[0]?.homeHost;
		expect(await homeHost()).toBeNull();

		await links.save({
			...link,
			hostId: "host-c",
			addresses: ["https://new.example.com"],
		});
		expect(await links.get("host-a")).toBeNull();
		expect(await homeHost()).toBe("https://new.example.com");
	});

	test("a key kept in a file is readable by its owner only", async () => {
		const store = await deviceKeyStore({
			dataDir: sandbox.dataDir,
			prefer: "file",
		});
		expect(store.kind).toBe("file");
		expect(await store.get("host-a")).toBeNull();
		await store.set("host-a", "nsd_secret");
		expect(await store.get("host-a")).toBe("nsd_secret");
		const { mode } = await import("node:fs/promises").then((fs) =>
			fs.stat(`${sandbox.dataDir}/device-keys/host-a`),
		);
		expect(mode & 0o777).toBe(0o600);
		await store.delete("host-a");
		expect(await store.get("host-a")).toBeNull();
	});
});
