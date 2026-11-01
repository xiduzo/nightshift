import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";
import { daemonLease } from "@nightshift/db/schema";
import { asDate, now as timeNow } from "@nightshift/time";
import { type Heartbeat, readHeartbeatFile } from "../heartbeat";
import {
	checkHealth,
	elapsedSeconds,
	leaseHealth,
	readHeartbeat,
	stopHolder,
} from "./health";
import { acquireLease, pidAlive } from "./lease";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

/** A migrated database in a fresh data folder. */
async function database() {
	const root = mkdtempSync(join(tmpdir(), "nightshift-health-"));
	roots.push(root);
	const path = join(root, "nightshift.db");
	const db = createDb({ DATABASE_URL: `file:${path}` });
	await migrateDb(db);
	return { db, path, url: `file:${path}` };
}

const heartbeat = (at: number, owner: string | null = "a"): Heartbeat => ({
	owner,
	host: "mac",
	pid: 1,
	acquiredAt: 0,
	heartbeatAt: at,
});

describe("the health of the lease", () => {
	test("a heartbeat of 30 s or less is fresh, an older one stale", () => {
		const now = 100_000;
		expect(leaseHealth(heartbeat(now - 30_000), { now })).toEqual({
			healthy: true,
			status: "running",
			heartbeatAgeMs: 30_000,
		});
		expect(leaseHealth(heartbeat(now - 31_000), { now }).status).toBe("stale");
	});

	test("no lease, a lease given up, and another daemon's lease are not healthy", () => {
		expect(leaseHealth(null).status).toBe("none");
		expect(leaseHealth(heartbeat(timeNow(), null)).status).toBe("stopped");
		expect(leaseHealth(heartbeat(timeNow(), "b"), { owner: "a" })).toEqual({
			healthy: false,
			status: "other",
			heartbeatAgeMs: expect.any(Number),
		});
	});

	test("the daemon and another process read the same lease", async () => {
		const { db, path } = await database();
		expect(readHeartbeatFile(path)).toBeNull();
		const lease = await acquireLease({ db });
		const fromDaemon = await readHeartbeat(db);
		expect(fromDaemon).toMatchObject({ owner: lease.owner, pid: process.pid });
		expect(readHeartbeatFile(path)).toEqual(fromDaemon);
		await lease.release();
	});

	test("no database file reads as no lease", () => {
		expect(readHeartbeatFile(join(tmpdir(), "nightshift-none.db"))).toBeNull();
	});
});

test("ps's elapsed time in seconds", () => {
	expect(elapsedSeconds("  00:07\n")).toBe(7);
	expect(elapsedSeconds("01:02:03")).toBe(3_723);
	expect(elapsedSeconds("2-00:00:01")).toBe(172_801);
	expect(elapsedSeconds("soon")).toBeNull();
});

describe("nightshift health", () => {
	const quiet = () => {};

	test("exit code 0 while the heartbeat is fresh, 1 when it is stale", async () => {
		const { db, url } = await database();
		await acquireLease({ db });
		expect(await checkHealth({ url, restart: false, log: quiet })).toBe(0);
		await db
			.update(daemonLease)
			.set({ heartbeatAt: asDate(timeNow() - 60_000) });
		expect(await checkHealth({ url, restart: false, log: quiet })).toBe(1);
	});

	test("--restart stops the daemon of a stale lease: SIGTERM, then SIGKILL", async () => {
		const { db, url } = await database();
		// A daemon whose timers died: it ignores SIGTERM too.
		const stuck = Bun.spawn([
			process.execPath,
			"-e",
			"process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)",
		]);
		await Bun.sleep(200);
		const at = asDate(timeNow() + 1_000);
		await db.insert(daemonLease).values({
			id: 1,
			owner: "stuck",
			host: hostname(),
			pid: stuck.pid,
			epoch: 1,
			acquiredAt: at,
			heartbeatAt: asDate(timeNow() - 60_000),
		});
		const logs: string[] = [];
		const code = await checkHealth({
			url,
			restart: true,
			recheckMs: 10,
			graceMs: 500,
			log: (message) => logs.push(message),
		});
		expect(code).toBe(1);
		expect(await stuck.exited).not.toBe(0);
		expect(stuck.signalCode).toBe("SIGKILL");
		expect(logs.join("\n")).toContain("Killing it");
	});

	test("--restart leaves alone a process that started after the lease", async () => {
		// The pid of a daemon that died, given to another process since.
		const other = Bun.spawn([
			process.execPath,
			"-e",
			"setInterval(() => {}, 1000)",
		]);
		await Bun.sleep(200);
		const stopped = await stopHolder(
			{
				owner: "gone",
				host: hostname(),
				pid: other.pid,
				acquiredAt: timeNow() - 3_600_000,
				heartbeatAt: timeNow() - 3_600_000,
			},
			{ log: () => {} },
		);
		expect(stopped).toBe(false);
		expect(pidAlive(other.pid)).toBe(true);
		other.kill("SIGKILL");
	});

	test("--restart never stops a daemon on another computer", async () => {
		const stopped = await stopHolder(
			{ ...heartbeat(0), host: "elsewhere", pid: process.pid },
			{ log: () => {} },
		);
		expect(stopped).toBe(false);
	});
});
