import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createDb } from "@nightshift/db";
import { daemonLease } from "@nightshift/db/schema";
import { createSandbox, type Sandbox } from "@nightshift/engine/testing";
import { acquireLease, LeaseHeldError } from "./lease";

let sandbox: Sandbox;
let clock: number;
beforeEach(async () => {
	sandbox = await createSandbox();
	clock = Date.parse("2026-10-16T22:00:00Z");
});
afterEach(async () => {
	await sandbox.cleanup();
});

const SECOND = 1_000;

/** A daemon on this database with the test's clock. Every pid is alive unless the test says otherwise. */
function daemon(
	options: {
		host?: string;
		pid?: number;
		isAlive?: (pid: number) => boolean;
		onLost?: (reason: string) => void;
	} = {},
) {
	return acquireLease({
		db: sandbox.db,
		now: () => clock,
		host: options.host ?? "mac",
		pid: options.pid ?? 100,
		isAlive: options.isAlive ?? (() => true),
		onLost: options.onLost,
	});
}

async function row() {
	const [lease] = await sandbox.db.select().from(daemonLease);
	return lease;
}

describe("acquire", () => {
	test("a free database gives the lease at epoch 1", async () => {
		const lease = await daemon();
		expect(lease.epoch).toBe(1);
		expect(lease.host).toBe("mac");
		expect(lease.pid).toBe(100);
		expect(lease.since.getTime()).toBe(clock);
		expect(await row()).toMatchObject({
			owner: lease.owner,
			epoch: 1,
			host: "mac",
			pid: 100,
		});
	});

	test("every acquisition adds one to the epoch", async () => {
		const first = await daemon();
		await first.release();
		const second = await daemon({ pid: 101 });
		await second.release();
		const third = await daemon({ pid: 102 });
		expect([first.epoch, second.epoch, third.epoch]).toEqual([1, 2, 3]);
	});

	test("a live holder refuses the second daemon, with its host, pid and start", async () => {
		const holder = await daemon({ host: "mac", pid: 100 });
		clock += 30 * SECOND;
		const refused = await daemon({ host: "mac", pid: 200 }).catch((e) => e);
		expect(refused).toBeInstanceOf(LeaseHeldError);
		expect(refused.message).toContain("pid 100 on mac");
		expect(refused.message).toContain(holder.since.toISOString());
		expect(refused.message).toContain("its own NIGHTSHIFT_DATA_DIR");
		expect((await row())?.owner).toBe(holder.owner);
	});

	test("a holder on another host is not probed: only its heartbeat counts", async () => {
		await daemon({ host: "other", pid: 100 });
		const refused = await daemon({
			host: "mac",
			pid: 200,
			isAlive: () => false,
		}).catch((e) => e);
		expect(refused).toBeInstanceOf(LeaseHeldError);
	});

	test("a holder whose heartbeat is older than the stale window is taken over", async () => {
		const holder = await daemon({ host: "other", pid: 100 });
		clock += 91 * SECOND;
		const next = await daemon({ host: "mac", pid: 200 });
		expect(next.epoch).toBe(holder.epoch + 1);
		expect((await row())?.owner).toBe(next.owner);
	});

	test("a holder on this host whose pid is dead is taken over at once", async () => {
		const holder = await daemon({ pid: 100 });
		clock += SECOND;
		const next = await daemon({ pid: 200, isAlive: (pid) => pid !== 100 });
		expect(next.epoch).toBe(holder.epoch + 1);
	});

	test("two daemons racing for a free database: only one wins", async () => {
		// Two clients on one file, like two processes.
		const other = createDb({ DATABASE_URL: `file:${sandbox.dbPath}` });
		const results = await Promise.allSettled([
			daemon({ pid: 100 }),
			acquireLease({
				db: other,
				now: () => clock,
				host: "mac",
				pid: 200,
				isAlive: () => true,
			}),
			daemon({ pid: 300 }),
		]);
		const won = results.filter((r) => r.status === "fulfilled");
		const lost = results.filter((r) => r.status === "rejected");
		expect(won).toHaveLength(1);
		expect(lost).toHaveLength(2);
		for (const r of lost) {
			expect((r as PromiseRejectedResult).reason).toBeInstanceOf(
				LeaseHeldError,
			);
		}
		expect((await row())?.epoch).toBe(1);
	});

	test("two daemons racing to take over a stale lease: only one wins", async () => {
		await daemon({ host: "other", pid: 1 });
		clock += 120 * SECOND;
		const results = await Promise.allSettled([
			daemon({ pid: 100 }),
			daemon({ pid: 200 }),
		]);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		expect((await row())?.epoch).toBe(2);
	});
});

describe("heartbeat", () => {
	test("keeps the lease after a long gap when nobody took it", async () => {
		const lost: string[] = [];
		const lease = await daemon({ onLost: (reason) => lost.push(reason) });
		// The laptop slept all night.
		clock += 9 * 60 * 60 * SECOND;
		expect(await lease.heartbeat()).toBe(true);
		expect(lost).toEqual([]);
		expect(lease.signal.aborted).toBe(false);
		expect((await row())?.heartbeatAt.getTime()).toBe(clock);
	});

	test("a heartbeat after a takeover reports the loss once", async () => {
		const lost: string[] = [];
		const lease = await daemon({
			host: "laptop",
			pid: 100,
			onLost: (reason) => lost.push(reason),
		});
		clock += 2 * 60 * SECOND;
		const next = await daemon({ host: "mac", pid: 200 });
		expect(await lease.heartbeat()).toBe(false);
		expect(await lease.heartbeat()).toBe(false);
		expect(lost).toHaveLength(1);
		expect(lost[0]).toContain("epoch 1 lost to pid 200 on mac (epoch 2)");
		expect(lease.signal.aborted).toBe(true);
		// The loser wrote nothing: the new holder's row is untouched.
		expect(await row()).toMatchObject({ owner: next.owner, epoch: 2 });
		expect(await next.heartbeat()).toBe(true);
	});
});

describe("release", () => {
	test("the next daemon starts at once after a release", async () => {
		const lost: string[] = [];
		const lease = await daemon({ onLost: (reason) => lost.push(reason) });
		await lease.release();
		expect((await row())?.owner).toBeNull();
		// The released daemon's pid still runs, and its heartbeat is fresh.
		const next = await daemon({ pid: 200 });
		expect(next.epoch).toBe(2);
		expect(lost).toEqual([]);
		expect(await lease.heartbeat()).toBe(false);
	});

	test("a release after a takeover leaves the new holder alone", async () => {
		const lease = await daemon({ pid: 100 });
		clock += 2 * 60 * SECOND;
		const next = await daemon({ pid: 200 });
		await lease.release();
		expect(await row()).toMatchObject({ owner: next.owner, epoch: 2 });
	});
});
