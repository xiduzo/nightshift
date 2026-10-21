import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { device } from "@nightshift/db/schema";
import { createSandbox, type Sandbox } from "@nightshift/engine/testing";
import { eq } from "drizzle-orm";
import { hostDeviceName, selfDevice, selfDeviceId } from "./self-device";

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
});
