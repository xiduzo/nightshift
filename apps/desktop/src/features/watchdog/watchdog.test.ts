import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

/** A database with only the lease row, its heartbeat this old. */
function leaseDatabase(owner: string, heartbeatAgeMs: number): string {
	const root = mkdtempSync(join(tmpdir(), "nightshift-watchdog-"));
	roots.push(root);
	const path = join(root, "nightshift.db");
	const db = new Database(path);
	db.run(
		"CREATE TABLE daemon_lease (id INTEGER PRIMARY KEY, owner TEXT, host TEXT, pid INTEGER, epoch INTEGER, acquired_at INTEGER, heartbeat_at INTEGER)",
	);
	db.run("INSERT INTO daemon_lease VALUES (1, ?, 'mac', ?, 1, ?, ?)", [
		owner,
		process.pid,
		Date.now(),
		Date.now() - heartbeatAgeMs,
	]);
	db.close();
	return path;
}

/** Runs the fixture: a main thread whose timers die under `bun --hot`. */
async function run(database: string, owner: string, ms: number) {
	const child = Bun.spawn(
		[
			process.execPath,
			"--hot",
			join(import.meta.dir, "fixtures", "dead-timers.ts"),
			database,
			owner,
		],
		{ stdout: "pipe", stderr: "pipe" },
	);
	const stop = setTimeout(() => child.kill("SIGTERM"), ms);
	const [stdout, stderr] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	clearTimeout(stop);
	return { stdout, stderr, signal: child.signalCode };
}

test("the Worker kills the app when the daemon's timers died and its heartbeat is stale", async () => {
	// The Worker kills it two checks after it starts. A busy machine can take
	// seconds to start the app and its Worker: the SIGTERM only ends a hang.
	const { stdout, stderr, signal } = await run(
		leaseDatabase("app", 60_000),
		"app",
		60_000,
	);
	// The main thread's timers are dead: only the Worker's still run.
	expect(stdout).not.toContain("main timers alive");
	expect(stderr).toContain("WATCHDOG");
	expect(signal).toBe("SIGKILL");
}, 90_000);

test("the Worker leaves the app alone while the heartbeat is fresh", async () => {
	const { stderr, signal } = await run(leaseDatabase("app", 0), "app", 700);
	expect(stderr).not.toContain("WATCHDOG");
	expect(signal).toBe("SIGTERM");
});

test("the Worker leaves the app alone when another daemon holds the lease", async () => {
	const { stderr, signal } = await run(
		leaseDatabase("other", 60_000),
		"app",
		700,
	);
	expect(stderr).not.toContain("WATCHDOG");
	expect(signal).toBe("SIGTERM");
});
