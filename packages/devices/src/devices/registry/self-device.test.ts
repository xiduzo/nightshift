import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { clone, device, event, project } from "@nightshift/db/schema";
import {
	createRunLog,
	createSandbox,
	deviceRowsOn,
	type Sandbox,
} from "@nightshift/engine/testing";
import { eq } from "drizzle-orm";
import { wireRegistry } from "./wire";

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

const host = { name: "studio", platform: "linux" };

/** This computer's Device, as a start of Night Shift finds it. */
const selfDevice = () =>
	wireRegistry({ db: sandbox.db }).ensureSelfDevice({ host });

/** This install becomes the Device its home Host knows, without a log of Devices. */
const adopt = (deviceId: string, lastSeq?: number) =>
	wireRegistry({ db: sandbox.db })
		.paired({
			logFact: async () => {},
			history: {
				devicePresence: async () => new Map(),
				lastWalkerSeq: async () => 0,
			},
			deviceRows: deviceRowsOn(sandbox.db),
		})
		.adopt(deviceId, lastSeq);

describe("selfDevice", () => {
	test("a database without one makes it, once", async () => {
		await sandbox.db.delete(device);
		const [a, b] = await Promise.all([selfDevice(), selfDevice()]);
		expect(a).toEqual(b as typeof a);
		expect(a.name).toBe("studio");
		expect(await sandbox.db.select().from(device)).toHaveLength(1);
	});
});

describe("adoptSelfDevice", () => {
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
		await createRunLog(sandbox.db, {
			walkerId: from,
			dataDir: sandbox.dataDir,
		}).append({
			type: "DeviceOnline",
			payload: { deviceId: from },
			spaceId: sandbox.spaceId,
		});

		await adopt("known-to-the-host");

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
		const before = createRunLog(sandbox.db, {
			walkerId: from,
			dataDir: sandbox.dataDir,
		});
		await before.append({
			type: "DeviceOnline",
			payload: { deviceId: from },
			spaceId: sandbox.spaceId,
		});
		const lastOfMine = await sandbox.db
			.select({ walkerSeq: event.walkerSeq })
			.from(event)
			.where(eq(event.walkerId, from));

		await adopt("known-to-the-host", 500);

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
			dataDir: sandbox.dataDir,
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
		await adopt("known-to-the-host", 7);
		await createRunLog(sandbox.db, {
			walkerId: "known-to-the-host",
			dataDir: sandbox.dataDir,
		}).append({
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
});
