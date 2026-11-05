import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { clone, device, event, project } from "@nightshift/db/schema";
import {
	createRunLog,
	createSandbox,
	type Sandbox,
} from "@nightshift/engine/testing";
import { eq } from "drizzle-orm";
import {
	adoptSelfDevice,
	defaultSelfDeviceHost,
	hostDeviceName,
	isContainerId,
	selfDevice,
} from "./self-device";

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

const host = { name: "studio", platform: "linux" };

describe("selfDevice", () => {
	test("one row is this computer, with the same id on every call", async () => {
		const first = await selfDevice(sandbox.db, host);
		expect(first.id).toBe(sandbox.deviceId);
		expect(await selfDevice(sandbox.db, host)).toEqual(first);
		expect(
			await sandbox.db.select().from(device).where(eq(device.self, true)),
		).toHaveLength(1);
	});

	test("a database without one makes it, once", async () => {
		await sandbox.db.delete(device);
		const [a, b] = await Promise.all([
			selfDevice(sandbox.db, host),
			selfDevice(sandbox.db, host),
		]);
		expect(a).toEqual(b as typeof a);
		expect(a.name).toBe("studio");
		expect(await sandbox.db.select().from(device)).toHaveLength(1);
	});

	test("a name the person gave stays; a blank one is the host name", async () => {
		await sandbox.db.update(device).set({ name: "" });
		expect((await selfDevice(sandbox.db, host)).name).toBe("studio");
		await sandbox.db.update(device).set({ name: "MacBook" });
		expect((await selfDevice(sandbox.db, host)).name).toBe("MacBook");
	});

	test("the host name drops the .local of macOS", () => {
		expect(hostDeviceName("Adas-MacBook.local")).toBe("Adas-MacBook");
		expect(hostDeviceName("hetzner-1")).toBe("hetzner-1");
	});

	test("a stale default name becomes the new default; a chosen one stays", async () => {
		const docker = defaultSelfDeviceHost({
			env: {},
			hostName: "0123456789ab",
			container: true,
			platform: "linux",
		});
		await sandbox.db.update(device).set({ name: "cea79743b08a" });
		expect((await selfDevice(sandbox.db, docker)).name).toBe("Host");
		await sandbox.db.update(device).set({ name: "studio" });
		expect((await selfDevice(sandbox.db, docker)).name).toBe("studio");
	});
});

describe("defaultSelfDeviceHost", () => {
	const of = (
		hostName: string,
		container: boolean,
		env: Record<string, string> = {},
	) => defaultSelfDeviceHost({ env, hostName, container, platform: "linux" });

	test("NIGHTSHIFT_DEVICE_NAME wins over the host name", () => {
		const host = of("cea79743b08a", true, {
			NIGHTSHIFT_DEVICE_NAME: " Office Host ",
		});
		expect(host.name).toBe("Office Host");
		expect(host.stale?.("cea79743b08a")).toBe(true);
		expect(host.stale?.("Office Host")).toBe(false);
	});

	test("a container named by its id takes the name of its Host address", () => {
		const host = of("cea79743b08a", true, {
			NIGHTSHIFT_HOST_ADDRESSES: "not a url, https://ns.example.com:8443",
		});
		expect(host.name).toBe("ns.example.com");
		expect(host.stale?.("Host")).toBe(true);
		expect(host.stale?.("cea79743b08a")).toBe(true);
	});

	test("a container named by its id without an address is a Host", () => {
		expect(of("cea79743b08a", true).name).toBe("Host");
		expect(of("nightshift", true).name).toBe("nightshift");
	});

	test("outside a container, Host is a chosen name", () => {
		expect(of("Adas-MacBook", false).stale?.("Host")).toBe(false);
	});

	test("outside a container the host name stays, hex or not", () => {
		const host = of("cea79743b08a", false);
		expect(host.name).toBe("cea79743b08a");
		expect(host.stale?.("deadbeef0000")).toBe(false);
		expect(of("Adas-MacBook.local", false).name).toBe("Adas-MacBook");
	});

	test("a new dev Device is named apart from the desktop app's", () => {
		const host = defaultSelfDeviceHost({
			env: {},
			hostName: "LE2316.local",
			container: false,
			platform: "darwin",
			dev: true,
		});
		expect(host.name).toBe("LE2316 (dev)");
		// A dev Device that still has the host name takes the new name (ADR 17).
		expect(host.stale?.("LE2316")).toBe(true);
		const named = defaultSelfDeviceHost({
			env: { NIGHTSHIFT_DEVICE_NAME: "Studio" },
			hostName: "LE2316",
			container: false,
			dev: true,
		});
		expect(named.name).toBe("Studio");
	});

	test("a container id is a 12 or 64 hex host name", () => {
		expect(isContainerId("cea79743b08a")).toBe(true);
		expect(isContainerId("a".repeat(64))).toBe(true);
		expect(isContainerId("hetzner-1")).toBe(false);
		expect(isContainerId("CEA79743B08A")).toBe(false);
	});
});

describe("adoptSelfDevice", () => {
	test("this install becomes the Device, and its name and owner stay", async () => {
		await sandbox.db.update(device).set({ name: "MacBook" });
		const [before] = await sandbox.db.select().from(device);
		await adoptSelfDevice(sandbox.db, "known-to-the-host");
		const rows = await sandbox.db.select().from(device);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			id: "known-to-the-host",
			self: true,
			name: "MacBook",
			ownerId: before?.ownerId,
		});
		expect((await selfDevice(sandbox.db, host)).id).toBe("known-to-the-host");
	});

	test("what names the id it had names the Device now", async () => {
		const from = sandbox.deviceId;
		await sandbox.db.insert(project).values({
			id: "p1",
			spaceId: sandbox.spaceId,
			name: "p1",
		});
		await sandbox.db.insert(clone).values({
			id: "c1",
			spaceId: sandbox.spaceId,
			projectId: "p1",
			deviceId: from,
			path: sandbox.repoPath,
		});
		await createRunLog(sandbox.db, { walkerId: from }).append({
			type: "DeviceOnline",
			payload: { deviceId: from },
			spaceId: sandbox.spaceId,
		});

		await adoptSelfDevice(sandbox.db, "known-to-the-host");

		expect(
			await sandbox.db.select({ deviceId: clone.deviceId }).from(clone),
		).toEqual([{ deviceId: "known-to-the-host" }]);
		const walkers = await sandbox.db
			.select({ walkerId: event.walkerId })
			.from(event);
		expect(walkers.length).toBeGreaterThan(0);
		expect(walkers.every((e) => e.walkerId === "known-to-the-host")).toBe(true);
	});

	test("its events count on after the last the Host has, so the Host drops none", async () => {
		const from = sandbox.deviceId;
		const before = createRunLog(sandbox.db, { walkerId: from });
		await before.append({
			type: "DeviceOnline",
			payload: { deviceId: from },
			spaceId: sandbox.spaceId,
		});
		const lastOfMine = await sandbox.db
			.select({ walkerSeq: event.walkerSeq })
			.from(event)
			.where(eq(event.walkerId, from));

		await adoptSelfDevice(sandbox.db, "known-to-the-host", 500);

		const moved = (
			await sandbox.db
				.select({ walkerSeq: event.walkerSeq })
				.from(event)
				.where(eq(event.walkerId, "known-to-the-host"))
		).map((e) => e.walkerSeq);
		expect(moved).toContain(500);
		for (const { walkerSeq } of lastOfMine) {
			expect(moved).toContain(walkerSeq + 500);
		}
		const next = await createRunLog(sandbox.db, {
			walkerId: "known-to-the-host",
		}).append({
			type: "DeviceOnline",
			payload: { deviceId: "known-to-the-host" },
			spaceId: sandbox.spaceId,
		});
		expect(next.seq).toBeGreaterThan(0);
		const highest = Math.max(
			...(
				await sandbox.db
					.select({ walkerSeq: event.walkerSeq })
					.from(event)
					.where(eq(event.walkerId, "known-to-the-host"))
			).map((e) => e.walkerSeq),
		);
		expect(highest).toBeGreaterThan(500);
	});

	test("with no events of its own, the next event still comes after the Host's", async () => {
		await sandbox.db.delete(event);
		await adoptSelfDevice(sandbox.db, "known-to-the-host", 7);
		await createRunLog(sandbox.db, { walkerId: "known-to-the-host" }).append({
			type: "DeviceOnline",
			payload: { deviceId: "known-to-the-host" },
			spaceId: sandbox.spaceId,
		});
		const counts = (
			await sandbox.db
				.select({ walkerSeq: event.walkerSeq })
				.from(event)
				.where(eq(event.walkerId, "known-to-the-host"))
		).map((e) => e.walkerSeq);
		expect(counts.sort((a, b) => a - b)).toEqual([7, 8]);
	});

	test("the same id changes nothing", async () => {
		await adoptSelfDevice(sandbox.db, sandbox.deviceId);
		expect((await selfDevice(sandbox.db, host)).id).toBe(sandbox.deviceId);
	});
});
