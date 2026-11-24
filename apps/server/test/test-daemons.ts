import { join } from "node:path";
import type { AppRouterClient } from "@nightshift/api";
import type { SpaceEngine, SpaceFlows } from "@nightshift/engine";
import { messageOf } from "@nightshift/refusal";
import { now } from "@nightshift/time";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { Subprocess } from "bun";

/**
 * Daemons as processes, for tests of several Devices: each runs on its
 * own port with its own data directory (the daemon's services are one per
 * process). A test calls each daemon as that computer's Person: a
 * loopback request without a session gets the local session.
 */

export const SERVER_DIR = join(import.meta.dir, "..");

export type Daemon = {
	name: string;
	url: string;
	port: number;
	dataDir: string;
	env: Record<string, string>;
	client: AppRouterClient;
	/**
	 * The daemon's process. Its `stderr` is a copy of what the daemon
	 * writes there, for a caller that keeps a log of its own.
	 */
	process: Subprocess<"ignore", "pipe", "pipe">;
	/** The last lines the daemon wrote, stdout and stderr in the order they came. */
	output: () => string;
};

/**
 * The flow saves of a daemon, as a person makes them in its Space: what
 * `seedFlows` takes. Every Device of the Space gets them through the Host.
 */
export function savesOn(
	daemon: Daemon,
): { flows: Pick<SpaceFlows, "save"> } & Pick<SpaceEngine, "saveSchedules"> {
	return {
		flows: {
			save: (projectId, name, flow) =>
				daemon.client.flows.save({ projectId, name, flow }),
		},
		saveSchedules: (projectId, schedules) =>
			daemon.client.schedules.save({ projectId, schedules: [...schedules] }),
	};
}

/** A port that is free at the address a daemon listens on. `localhost` would ask for `::1` only. */
export async function freePort(): Promise<number> {
	const probe = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		fetch: () => new Response(),
	});
	const port = probe.port as number;
	probe.stop(true);
	return port;
}

/**
 * The longest a daemon may take to answer after its start. A start took
 * 3.4 to 4.2 s with two daemons at once at load 170 to 180 (16 cores).
 * This is seven times that. It stays below the 60 s `beforeAll` limit of
 * the files that only start a daemon: a slow start fails with the error
 * of `startDaemon`, not with the limit of the hook.
 */
const ANSWER_MS = 30_000;

/** The daemon's own line once it listens (`packages/daemon/src/start.ts`). */
const LISTENS = "Night Shift answers at";

/**
 * The daemon's own line when another program has its port
 * (`PortTakenError`). It then stops and exits with code 1.
 */
const PORT_IN_USE = "Night Shift cannot listen on port";

type Started = "listens" | "port in use";

/** What `untilAnswers` says when another program has the daemon's port. */
const PORT_TAKEN = "it cannot listen: another process has the port.";

/** The output of a daemon, as `readOutput` follows it. */
type Output = {
	/** What the daemon said of its start: it listens, or its port is in use. */
	started: Promise<Started>;
	/** What it said first of its start, or null. */
	heard: () => Started | null;
	/** Settles once the process ended and its streams closed, or a little later. */
	read: () => Promise<void>;
	tail: () => string;
};

/** How much of the daemon's output an error shows. */
const OUTPUT_LINES = 40;

/** After the daemon ended: how long its streams may take to close. */
const STREAMS_CLOSE_MS = 2_000;

/** The children that `stopDaemon` stopped on purpose. */
const stopped = new WeakSet<Subprocess>();

/**
 * The environment of the dev entry (`bun src/main.ts`) for a daemon in
 * `<root>/<name>` on `port`. `env` wins.
 */
export function daemonEnv(
	root: string,
	name: string,
	port: number,
	env: Record<string, string> = {},
): Record<string, string> {
	return {
		PATH: process.env.PATH ?? "",
		HOME: process.env.HOME ?? root,
		NODE_ENV: "test",
		PORT: String(port),
		BETTER_AUTH_SECRET: `a-test-secret-of-at-least-32-characters-${name}`,
		BETTER_AUTH_URL: `http://localhost:${port}`,
		CORS_ORIGIN: "http://localhost:3001",
		NIGHTSHIFT_DATA_DIR: join(root, name),
		NIGHTSHIFT_SCHEDULER: "off",
		NIGHTSHIFT_KEY_STORE: "file",
		NIGHTSHIFT_DESKTOP_NOTIFICATIONS: "off",
		...env,
	};
}

/**
 * Starts a daemon in `<root>/<name>`, on `port` (a free one by default),
 * and waits until it says it listens and answers there. Throws when it
 * stops first or does not answer within `ANSWER_MS`, with what it wrote.
 */
export async function startDaemon(
	root: string,
	name: string,
	env: Record<string, string>,
	port?: number,
): Promise<Daemon> {
	const at = port ?? (await freePort());
	const url = `http://localhost:${at}`;
	const dataDir = join(root, name);
	const begun = now();
	const child = Bun.spawn(["bun", "src/main.ts"], {
		cwd: SERVER_DIR,
		env: daemonEnv(root, name, at, env),
		// Both streams are read all the time: a full pipe stops the daemon.
		stdout: "pipe",
		stderr: "pipe",
	});
	const output = readOutput(child);
	/** What went wrong, and the daemon's last lines once it wrote them all. */
	const said = async (line: string) => {
		await output.read();
		return `Daemon "${name}" (${url}): ${line} Its last output:\n${output.tail()}`;
	};
	const failure = await untilAnswers(child, output, url, begun);
	if (failure !== null) {
		child.kill("SIGKILL");
		await child.exited;
		throw new Error(await said(failure));
	}
	// A daemon that ends while a test still uses it fails that test with a
	// refused call. This says why, in the test's output. A stop through
	// `stopDaemon`, or any other that ends with code 0, is no news.
	void child.exited.then(async () => {
		if (!stopped.has(child) && child.exitCode !== 0) {
			console.error(await said(`it stopped (${endOf(child)}) while in use.`));
		}
	});
	const client: AppRouterClient = createORPCClient(
		new RPCLink({ url: `${url}/rpc` }),
	);
	return {
		name,
		url,
		port: at,
		dataDir,
		env,
		client,
		process: child,
		output: output.tail,
	};
}

/**
 * Waits for the facts: the daemon says it listens, then GET / answers.
 * The time is only a ceiling. Returns what went wrong, or null.
 */
async function untilAnswers(
	child: Subprocess,
	output: Pick<Output, "started" | "heard" | "read">,
	url: string,
	begun: number,
): Promise<string | null> {
	const ceiling = `${ANSWER_MS / 1000} s`;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const said = await Promise.race([
		output.started,
		child.exited.then(() => "stopped" as const),
		new Promise<"late">((resolve) => {
			timer = setTimeout(() => resolve("late"), begun + ANSWER_MS - now());
		}),
	]);
	clearTimeout(timer);
	if (said === "stopped") {
		// A daemon whose port is taken exits at once: its line may still be
		// on its way.
		await output.read();
		if (output.heard() === "port in use") return PORT_TAKEN;
		return `it stopped (${endOf(child)}) before it listened.`;
	}
	if (said === "late") {
		return `it did not say "${LISTENS}" within ${ceiling} of its start.`;
	}
	if (said === "port in use") return PORT_TAKEN;
	// It listens, so GET / answers at once. A refusal now means that the
	// daemon stopped or that another process has the port.
	let last = "no answer";
	while (true) {
		try {
			const response = await fetch(url, {
				signal: AbortSignal.timeout(Math.max(begun + ANSWER_MS - now(), 1)),
			});
			if (response.ok) return null;
			last = `GET / answered ${response.status}`;
		} catch (error) {
			last = `GET / failed: ${messageOf(error)}`;
		}
		if (child.exitCode !== null || child.signalCode !== null) {
			return `it stopped (${endOf(child)}) after it said it listens. ${last}.`;
		}
		if (now() >= begun + ANSWER_MS) {
			return `it said it listens, but did not answer within ${ceiling} of its start. ${last}.`;
		}
		await Bun.sleep(100);
	}
}

/** How a process ended, for an error. */
function endOf(child: Subprocess): string {
	return child.signalCode !== null
		? `signal ${child.signalCode}`
		: `code ${child.exitCode}`;
}

/**
 * Reads both streams of the daemon, and keeps their last lines. The
 * child's `stderr` becomes a copy, for a caller that reads it itself.
 */
function readOutput(child: Subprocess<"ignore", "pipe", "pipe">): Output {
	const lines: string[] = [];
	let first: Started | null = null;
	let tell: (what: Started) => void = () => {};
	const started = new Promise<Started>((resolve) => {
		tell = resolve;
	});
	const heard = (what: Started) => {
		first ??= what;
		tell(what);
	};
	const follow = async (stream: ReadableStream<Uint8Array>) => {
		const decoder = new TextDecoder();
		let partial = "";
		try {
			for await (const chunk of stream) {
				const parts = (partial + decoder.decode(chunk, { stream: true })).split(
					"\n",
				);
				partial = parts.pop() ?? "";
				for (const line of parts) {
					if (line.includes(LISTENS)) heard("listens");
					if (line.includes(PORT_IN_USE)) heard("port in use");
					lines.push(line);
				}
				lines.splice(0, Math.max(lines.length - OUTPUT_LINES, 0));
			}
		} catch {
			// The process is gone: what it wrote is in `lines`.
		}
		if (partial) lines.push(partial);
	};
	const [kept, copy] = child.stderr.tee();
	Object.defineProperty(child, "stderr", { value: copy, configurable: true });
	const streams = Promise.all([follow(child.stdout), follow(kept)]);
	// A process the daemon started may hold a stream open after the daemon
	// ended. Its lines do not count then.
	const read = async () => {
		await child.exited;
		await Promise.race([streams, Bun.sleep(STREAMS_CLOSE_MS)]);
	};
	return {
		started,
		heard: () => first,
		read,
		tail: () =>
			lines.length > 0 ? lines.slice(-OUTPUT_LINES).join("\n") : "(nothing)",
	};
}

/** Stops a daemon the way a person does (SIGTERM), and waits for it. */
export async function stopDaemon(daemon: Daemon | undefined): Promise<void> {
	if (!daemon) return;
	stopped.add(daemon.process);
	daemon.process.kill("SIGTERM");
	await daemon.process.exited;
}

export async function waitFor<T>(
	read: () => Promise<T> | T,
	until: (value: T) => boolean,
	timeoutMs = 20_000,
): Promise<T> {
	const deadline = now() + timeoutMs;
	let value = await read();
	while (!until(value)) {
		if (now() > deadline) {
			throw new Error(`Timed out; last value: ${JSON.stringify(value)}`);
		}
		await Bun.sleep(100);
		value = await read();
	}
	return value;
}

/** The longest the command line may take to show its pairing code. */
const PAIR_CODE_MS = 60_000;

/**
 * Pairs `device` with `host` through the command line, `host`'s Person
 * approving the code. Returns the joining Device's id.
 */
export async function pair(host: Daemon, device: Daemon): Promise<string> {
	const cli = Bun.spawn(
		["bun", "src/join-cli.ts", host.url, "--daemon", device.url],
		{ cwd: SERVER_DIR, stdout: "pipe", stderr: "pipe" },
	);
	const output: string[] = [];
	const reader = (async () => {
		const decoder = new TextDecoder();
		for await (const chunk of cli.stdout) output.push(decoder.decode(chunk));
	})();
	// The command line is a new process: it loads the app, then asks the
	// Host for the code. On a busy computer that takes much longer than the
	// pairing. So this waits for the code or for the end of the process,
	// and the time is only a ceiling.
	let ended = false;
	void cli.exited.then(() => {
		ended = true;
	});
	const code = await waitFor(
		() => /\b([A-Z0-9]{4})-([A-Z0-9]{4})\b/.exec(output.join("")),
		(match) => match !== null || ended,
		PAIR_CODE_MS,
	);
	if (code === null) {
		throw new Error(
			`join ended without a code: ${await new Response(cli.stderr).text()}`,
		);
	}
	const userCode = `${code[1]}${code[2]}`;
	await host.client.devices.review({ userCode });
	await host.client.devices.approve({ userCode });
	if ((await cli.exited) !== 0) {
		throw new Error(`join failed: ${await new Response(cli.stderr).text()}`);
	}
	await reader;
	return (await device.client.devices.list()).thisComputer?.id as string;
}
