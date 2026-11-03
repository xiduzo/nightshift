import { expect, test } from "bun:test";
import { join } from "node:path";

/** Runs the fixture: a main thread whose timers die under `bun --hot`. */
async function run(mode: "die" | "live", ms: number) {
	const child = Bun.spawn(
		[
			process.execPath,
			"--hot",
			join(import.meta.dir, "fixtures", "dead-timers.ts"),
			mode,
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

test("the Worker kills the app when the daemon's timers died and its heartbeats stopped", async () => {
	// The Worker kills it two checks after it starts. A busy machine can take
	// seconds to start the app and its Worker: the SIGTERM only ends a hang.
	const { stdout, stderr, signal } = await run("die", 60_000);
	// The main thread's timers are dead: only the Worker's still run.
	expect(stdout).not.toContain("main timers alive");
	expect(stderr).toContain("WATCHDOG");
	expect(signal).toBe("SIGKILL");
}, 90_000);

test("the Worker leaves the app alone while the heartbeats come", async () => {
	const { stderr, signal } = await run("live", 2_500);
	expect(stderr).not.toContain("WATCHDOG");
	expect(signal).toBe("SIGTERM");
});
