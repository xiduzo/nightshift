import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { device } from "@nightshift/db/schema";
import { createSandbox, type Sandbox } from "@nightshift/engine/testing";
import { eq } from "drizzle-orm";
import {
	defaultSelfDeviceHost,
	hostDeviceName,
	isContainerId,
	selfDevice,
	selfDeviceId,
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

	test("its id, read without making a row", async () => {
		expect(await selfDeviceId(sandbox.db)).toBe(sandbox.deviceId);
		await sandbox.db.delete(device);
		expect(await selfDeviceId(sandbox.db)).toBeNull();
		expect(await sandbox.db.select().from(device)).toHaveLength(0);
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

	test("a container named by its id is a Host", () => {
		expect(of("cea79743b08a", true).name).toBe("Host");
		expect(of("nightshift", true).name).toBe("nightshift");
	});

	test("outside a container the host name stays, hex or not", () => {
		const host = of("cea79743b08a", false);
		expect(host.name).toBe("cea79743b08a");
		expect(host.stale?.("deadbeef0000")).toBe(false);
		expect(of("Adas-MacBook.local", false).name).toBe("Adas-MacBook");
	});

	test("a container id is a 12 or 64 hex host name", () => {
		expect(isContainerId("cea79743b08a")).toBe(true);
		expect(isContainerId("a".repeat(64))).toBe(true);
		expect(isContainerId("hetzner-1")).toBe(false);
		expect(isContainerId("CEA79743B08A")).toBe(false);
	});
});
