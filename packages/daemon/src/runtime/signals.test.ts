import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hot } from "./hot";
import { afterStops } from "./signals";

const fixture = join(import.meta.dir, "fixtures", "signal-stop.ts");

/** A fake `ollama serve`: it writes its pid, starts a runner, and waits. */
const SERVE = `#!/bin/sh
(sleep 30) & echo $! > "$DIR/runner"
echo $$ > "$DIR/serve"
wait
`;

let dir = "";
/** Processes the tests started, until they end. Only these are killed after a test. */
let procs: Bun.Subprocess[] = [];
/** The fake Ollama's server and runner, until a test saw them end. */
let grandchildren = new Set<number>();
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "nightshift-signals-"));
	await writeFile(join(dir, "ollama"), SERVE);
	await chmod(join(dir, "ollama"), 0o755);
});
afterEach(async () => {
	hot.nightshiftStopping = undefined;
	for (const proc of procs) {
		if (proc.exitCode === null && proc.signalCode === null)
			proc.kill("SIGKILL");
	}
	procs = [];
	for (const pid of grandchildren) {
		if (alive(pid)) process.kill(pid, "SIGKILL");
	}
	grandchildren = new Set();
	await rm(dir, { recursive: true, force: true });
});

const alive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

async function gone(pid: number): Promise<boolean> {
	for (let i = 0; i < 50 && alive(pid); i++) await Bun.sleep(20);
	if (alive(pid)) return false;
	grandchildren.delete(pid);
	return true;
}

async function readPid(name: string): Promise<number> {
	for (let i = 0; i < 200; i++) {
		const pid = Number(
			(
				await Bun.file(join(dir, name))
					.text()
					.catch(() => "")
			).trim(),
		);
		if (pid > 0) return pid;
		await Bun.sleep(20);
	}
	throw new Error(`no ${name} pid`);
}

/** The daemon of the fixture, once it is ready. */
async function daemon(env: Record<string, string>) {
	const proc = Bun.spawn(["bun", fixture], {
		env: { ...process.env, DIR: dir, OLLAMA: join(dir, "ollama"), ...env },
		stdout: "pipe",
		stderr: "inherit",
	});
	procs.push(proc);
	const reader = proc.stdout.getReader();
	let out = "";
	while (!out.includes("ready")) {
		const { value, done } = await reader.read();
		if (done) throw new Error(`the fixture ended: ${out}`);
		out += new TextDecoder().decode(value);
	}
	reader.releaseLock();
	return proc;
}

/** The started Ollama's server and runner, once both run. */
async function started(): Promise<number[]> {
	const serve = await readPid("serve");
	const runner = await readPid("runner");
	grandchildren.add(serve).add(runner);
	return [serve, runner];
}

/** The exit code of `proc`, or null when it still runs after `ms`. */
async function exitWithin(
	proc: ReturnType<typeof Bun.spawn>,
	ms: number,
): Promise<number | null> {
	return Promise.race([proc.exited, Bun.sleep(ms).then(() => null)]);
}

test("a first signal stops the started Ollama and exits with 0", async () => {
	const proc = await daemon({});
	const children = await started();
	proc.kill("SIGINT");
	expect(await exitWithin(proc, 3_000)).toBe(0);
	for (const pid of children) expect(await gone(pid)).toBe(true);
}, 15_000);

test("a second signal during a stop that hangs ends the started Ollama and exits at once", async () => {
	const proc = await daemon({ HANG: "1" });
	const children = await started();
	proc.kill("SIGINT");
	await Bun.sleep(200);
	expect(alive(proc.pid)).toBe(true);
	proc.kill("SIGINT");
	expect(await exitWithin(proc, 1_000)).toBe(130);
	for (const pid of children) expect(await gone(pid)).toBe(true);
}, 15_000);

test("a stop that gives up at its bound still ends the started Ollama", async () => {
	const proc = await daemon({ HANG: "1" });
	const children = await started();
	proc.kill("SIGTERM");
	expect(await exitWithin(proc, 4_000)).toBe(0);
	for (const pid of children) expect(await gone(pid)).toBe(true);
}, 15_000);

/** An Ollama that answers, started by the test, at the address it prints. */
const ANSWERING_OLLAMA = `const server = Bun.serve({ port: 0, fetch: () => Response.json({ version: "0.13.0" }) });
console.log(server.url.origin);`;

test("an Ollama found running, which Night Shift did not start, survives both signals", async () => {
	const other = Bun.spawn(["bun", "-e", ANSWERING_OLLAMA], {
		stdout: "pipe",
		stderr: "inherit",
	});
	procs.push(other);
	const reader = other.stdout.getReader();
	let at = "";
	while (!at.includes("\n")) {
		const { value, done } = await reader.read();
		if (done) throw new Error("the Ollama of the test ended");
		at += new TextDecoder().decode(value);
	}
	reader.releaseLock();
	at = at.trim();
	const proc = await daemon({ OLLAMA_AT: at, HANG: "1" });
	proc.kill("SIGINT");
	await Bun.sleep(200);
	proc.kill("SIGINT");
	expect(await exitWithin(proc, 1_000)).toBe(130);
	// Night Shift found it and started none of its own.
	expect(await Bun.file(join(dir, "serve")).exists()).toBe(false);
	await Bun.sleep(100);
	expect(other.exitCode).toBeNull();
	expect(other.signalCode).toBeNull();
	expect((await fetch(`${at}/api/version`)).ok).toBe(true);
}, 15_000);

test("a start that waits a short time for a stop says nothing", async () => {
	hot.nightshiftStopping = Bun.sleep(50);
	const said = spyOn(console, "log");
	try {
		await afterStops();
		// Past the moment it would have said it waits.
		await Bun.sleep(3_200);
		expect(said).not.toHaveBeenCalled();
	} finally {
		said.mockRestore();
	}
}, 10_000);
