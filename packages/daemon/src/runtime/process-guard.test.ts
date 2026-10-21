import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const fixture = join(import.meta.dir, "fixtures", "timers-after-error.ts");

/** Runs the fixture under `bun --hot`, as `bun run dev` runs the daemon. */
async function run(env: { GUARD?: "log" | "exit"; ERROR: string }) {
	const child = Bun.spawn([process.execPath, "--hot", fixture], {
		env: { ...process.env, ...env },
		stdout: "pipe",
		stderr: "pipe",
	});
	// Dead timers never end the fixture: stop it after a while.
	const stop = setTimeout(() => child.kill("SIGKILL"), 5_000);
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	clearTimeout(stop);
	return { stdout, stderr, code };
}

describe("an error nothing caught, under bun --hot", () => {
	test("an unhandled rejection is logged, and the timers go on", async () => {
		const { stdout, stderr, code } = await run({
			GUARD: "log",
			ERROR: "rejection",
		});
		expect(stderr).toContain("UNHANDLED REJECTION");
		expect(stdout).toContain("timers alive");
		expect(code).toBe(0);
	});

	test("an uncaught exception is logged, and the timers go on", async () => {
		const { stdout, stderr } = await run({ GUARD: "log", ERROR: "exception" });
		expect(stderr).toContain("UNCAUGHT EXCEPTION");
		expect(stdout).toContain("timers alive");
	});

	test("under a service manager, an uncaught exception exits with code 1", async () => {
		const { stdout, code } = await run({ GUARD: "exit", ERROR: "exception" });
		expect(stdout).not.toContain("timers alive");
		expect(code).toBe(1);
	});

	test("an unhandled rejection never exits, even under a service manager", async () => {
		const { stdout } = await run({ GUARD: "exit", ERROR: "rejection" });
		expect(stdout).toContain("timers alive");
	});
});
