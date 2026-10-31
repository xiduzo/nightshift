import {
	closeSync,
	mkdirSync,
	openSync,
	readSync,
	statSync,
	writeSync,
} from "node:fs";
import { dirname } from "node:path";
import type { JsonValue } from "@nightshift/flows";

import { type Device, runCommand, tailOf } from "../device";
import type {
	ServiceBringUp as BringUp,
	ServiceBroughtUp as BroughtUp,
	ServiceRunner,
	StopService,
} from "../graph";
import {
	type Scope,
	type ServiceHold,
	type ServiceSpec,
	scopeKey,
} from "../log";

/**
 * The services of the runs this computer walks (ADR 9): a process that a
 * Service node starts on its step's Device and that runs on in the
 * background while later steps work.
 *
 * - `bringUp` starts the service (`Device.exec` with `pid`, which the
 *   engine does not wait for) and tries its probe every `everySeconds`
 *   until it says ready, up to `timeoutMinutes`. A service that ends with
 *   a code other than 0 before it is ready failed. One that ends with 0
 *   (`docker compose up -d`) leaves the rest to the probe. What the
 *   service prints goes to its log file, on the computer that walks the
 *   run.
 * - `stop` stops services: with the node's `stop` command when it has
 *   one, then by ending the process group. A service this keeper did not
 *   start (the daemon restarted since) is stopped on its Device by its
 *   process id, only when the process there started when the log says
 *   (`startedAt`): an id the system gave again is left alone.
 *
 * The keeper writes no log events: its callers do (`ServiceStarted`,
 * `ServiceStopped`).
 */
export type ServiceKeeper = ServiceRunner;

/** How long a `stop` command may take before the engine ends the group. */
const STOP_COMMAND_MS = 2 * 60_000;
/** After the stop: how long the stream of the process may take to close. */
const STOP_WAIT_MS = 5_000;
/** One probe may take this long. */
const PROBE_MS = 10_000;
/** Where the output goes that nobody reads. */
const DEV_NULL = "/dev/null";
/** How much of the end of a log `tail` reads. */
const TAIL_READ_BYTES = 64 * 1024;

/** A process this keeper started, by run, scope and node. */
type Running = {
	device: Device;
	cwd: string;
	spec: ServiceSpec;
	logPath: string;
	controller: AbortController;
	/** Set once the process ended: its code, or null when it did not exit normally. */
	exit: { code: number | null; reason: string | null } | null;
	/** The stream of the process ended. */
	closed: Promise<void>;
};

const keyOf = (runId: string, scope: Scope | null, nodeId: string) =>
	`${runId}\u0000${scopeKey(scope)}\u0000${nodeId}`;

export function createServiceKeeper(deps: {
	now(): number;
	/** How long one second of `everySeconds` and `timeoutMinutes` lasts. 1 000 in production. */
	secondMs?: number;
	fetch?: typeof fetch;
}): ServiceKeeper {
	const secondMs = deps.secondMs ?? 1_000;
	const fetchUrl = deps.fetch ?? fetch;
	const running = new Map<string, Running>();

	async function bringUp(input: BringUp): Promise<BroughtUp> {
		const key = keyOf(input.runId, input.scope, input.nodeId);
		const before = running.get(key);
		// A loop visits the node again: the old process goes first.
		if (before) await stopRunning(key, before);
		const started = launch(input);
		running.set(key, started.process);
		const pid = await started.pid;
		const tail = () => tailOf(readTail(input.logPath));
		const failed = async (reason: string): Promise<BroughtUp> => {
			await stopRunning(key, started.process);
			return { kind: "failed", reason, logTail: tail() };
		};
		if (started.process.exit && started.process.exit.code !== 0) {
			return failed(
				started.process.exit.reason ??
					`The service ended with code ${started.process.exit.code} before it was ready.`,
			);
		}
		const startedAt =
			pid === null ? null : await processStart(input.device, input.cwd, pid);
		await input.onStarted({ pid, startedAt });

		const { spec } = input;
		const deadline = deps.now() + spec.timeoutMinutes * 60 * secondMs;
		let last: string | null = null;
		while (true) {
			if (input.signal.aborted) {
				await stopRunning(key, started.process);
				return { kind: "aborted", logTail: tail() };
			}
			const exit = started.process.exit;
			if (exit && exit.code !== 0) {
				return failed(
					exit.reason ??
						(exit.code === null
							? "The service stopped before it was ready."
							: `The service ended with code ${exit.code} before it was ready.`),
				);
			}
			const answer = await probe(input);
			if (answer.kind === "ready") {
				return {
					kind: "ready",
					...(answer.data !== undefined ? { data: answer.data } : {}),
					logTail: tail(),
				};
			}
			if (answer.kind === "broken") return failed(answer.reason);
			last = answer.reason;
			if (deps.now() >= deadline) {
				return failed(
					`The service was not ready after ${minutesText(spec.timeoutMinutes)}.${last ? ` ${last}` : ""}`,
				);
			}
			await pause(spec.everySeconds * secondMs, input.signal);
		}
	}

	/** Starts the process; `pid` settles when it runs or when it could not start. */
	function launch(input: BringUp): {
		process: Running;
		pid: Promise<number | null>;
	} {
		const controller = new AbortController();
		let settlePid: (pid: number | null) => void = () => {};
		const pid = new Promise<number | null>((resolve) => {
			settlePid = resolve;
		});
		const process: Running = {
			device: input.device,
			cwd: input.cwd,
			spec: input.spec,
			logPath: input.logPath,
			controller,
			exit: null,
			closed: Promise.resolve(),
		};
		process.closed = (async () => {
			mkdirSync(dirname(input.logPath), { recursive: true });
			const log = openSync(input.logPath, "a");
			try {
				for await (const event of input.device.exec({
					command: input.spec.start,
					cwd: input.cwd,
					env: input.spec.env,
					...(input.spec.secrets && input.spec.secrets.length > 0
						? { secrets: input.spec.secrets }
						: {}),
					pid: true,
					signal: controller.signal,
				})) {
					if (event.type === "started") {
						settlePid(event.pid);
						continue;
					}
					if (event.type === "refused") {
						process.exit = { code: null, reason: event.message };
						break;
					}
					if (event.type === "exit") {
						process.exit = {
							code: event.exitCode,
							reason: event.spawnError
								? `The service could not start: ${event.spawnError}`
								: null,
						};
						break;
					}
					writeSync(log, event.text);
				}
			} catch (error) {
				process.exit = {
					code: null,
					reason: `The service could not start: ${messageOf(error)}`,
				};
			} finally {
				closeSync(log);
				process.exit ??= { code: null, reason: null };
				// A Device that does not say the id: no process to stop by id.
				settlePid(null);
			}
		})();
		return { process, pid };
	}

	/** One try of the probe. */
	async function probe(
		input: BringUp,
	): Promise<
		| { kind: "ready"; data?: JsonValue }
		| { kind: "not-yet"; reason: string | null }
		| { kind: "broken"; reason: string }
	> {
		const { ready } = input.spec;
		const signal = AbortSignal.any([
			input.signal,
			AbortSignal.timeout(PROBE_MS),
		]);
		if ("url" in ready && input.here) {
			try {
				const response = await fetchUrl(ready.url, { signal });
				await response.body?.cancel();
				return response.ok
					? { kind: "ready" }
					: {
							kind: "not-yet",
							reason: `The address answered ${response.status}.`,
						};
			} catch {
				return { kind: "not-yet", reason: "The address did not answer." };
			}
		}
		const command =
			"url" in ready
				? `curl -fsS -o /dev/null --max-time ${PROBE_MS / 1000} "$NS_READY_URL"`
				: ready.command;
		const result = await runCommand(input.device, {
			command,
			cwd: input.cwd,
			env: {
				...input.spec.env,
				...("url" in ready ? { NS_READY_URL: ready.url } : {}),
			},
			...(input.spec.secrets && input.spec.secrets.length > 0
				? { secrets: input.spec.secrets }
				: {}),
			outputFile: true,
			// The probe's output is not the service's: only its last line counts.
			logPath: DEV_NULL,
			signal,
			onOutput: () => {},
		});
		if (result.refused !== null)
			return { kind: "broken", reason: result.refused };
		if (result.exitCode !== 0) {
			const said = result.logTail.split("\n").at(-1)?.trim() ?? "";
			return {
				kind: "not-yet",
				reason:
					result.exitCode === null
						? null
						: `The last check ended with code ${result.exitCode}${said ? `: ${said}` : "."}`,
			};
		}
		const written = result.output?.trim() ?? "";
		if (written === "") return { kind: "ready" };
		try {
			return { kind: "ready", data: JSON.parse(written) as JsonValue };
		} catch {
			return {
				kind: "broken",
				reason: "The data the ready command wrote is not valid JSON.",
			};
		}
	}

	/** The stop command, when the node has one, then the process group. */
	async function stopRunning(key: string, process: Running): Promise<void> {
		if (running.get(key) === process) running.delete(key);
		try {
			if (process.spec.stop !== null) {
				await stopCommand(process.device, process, process.spec.stop);
			}
		} finally {
			process.controller.abort();
			await Promise.race([process.closed, delay(STOP_WAIT_MS)]);
		}
	}

	/** Runs the node's `stop` command on the service's Device; its output goes to the service's log. */
	async function stopCommand(
		device: Device,
		at: { cwd: string; spec: ServiceSpec; logPath: string },
		command: string,
	): Promise<void> {
		await runCommand(device, {
			command,
			cwd: at.cwd,
			env: at.spec.env,
			...(at.spec.secrets && at.spec.secrets.length > 0
				? { secrets: at.spec.secrets }
				: {}),
			logPath: at.logPath,
			signal: AbortSignal.timeout(STOP_COMMAND_MS),
			onOutput: () => {},
		});
	}

	/** A service another daemon started: its stop command, then its process group by id. */
	async function stopRecorded(
		service: ServiceHold,
		device: Device,
	): Promise<void> {
		if (service.spec.stop !== null) {
			await stopCommand(device, service, service.spec.stop);
		}
		if (service.pid === null) return;
		await runCommand(device, {
			command: KILL_GROUP,
			cwd: service.cwd,
			env: {
				NS_SERVICE_PID: String(service.pid),
				NS_SERVICE_STARTED: service.startedAt ?? "",
			},
			logPath: service.logPath,
			signal: AbortSignal.timeout(STOP_WAIT_MS * 3),
			onOutput: () => {},
		});
	}

	async function stop(
		runId: string,
		services: readonly StopService[],
	): Promise<void> {
		for (const { service, device } of services) {
			const key = keyOf(runId, service.scope, service.nodeId);
			try {
				const process = running.get(key);
				if (process) await stopRunning(key, process);
				else if (device) await stopRecorded(service, device);
				else {
					console.warn(
						`[engine] run ${runId} cannot reach the device of its service "${service.nodeId}" to stop it`,
					);
				}
			} catch (error) {
				console.warn(
					`[engine] run ${runId} could not stop its service "${service.nodeId}"`,
					error,
				);
			}
		}
	}

	return {
		bringUp,
		stop,
		tail: (logPath) => tailOf(readTail(logPath)),
	};
}

/**
 * Ends the process group `NS_SERVICE_PID` on its Device: SIGTERM, then
 * SIGKILL. Only when the process with that id started at
 * `NS_SERVICE_STARTED` (`ps -o lstart=`): after a reboot the id may be
 * another process's. With no start time known it does nothing.
 */
const KILL_GROUP = [
	'p="$NS_SERVICE_PID"',
	'[ -n "$NS_SERVICE_STARTED" ] || exit 0',
	'now="$(ps -o lstart= -p "$p" 2>/dev/null | sed -e "s/^ *//" -e "s/ *$//")"',
	'[ "$now" = "$NS_SERVICE_STARTED" ] || exit 0',
	'kill -TERM -- "-$p" 2>/dev/null || exit 0',
	"i=0",
	'while kill -0 -- "-$p" 2>/dev/null && [ "$i" -lt 20 ]; do sleep 0.25; i=$((i + 1)); done',
	'kill -KILL -- "-$p" 2>/dev/null',
	"exit 0",
].join("\n");

/** When the process `pid` started on the Device, as `ps -o lstart=` says, or null. */
async function processStart(
	device: Device,
	cwd: string,
	pid: number,
): Promise<string | null> {
	let out = "";
	const result = await runCommand(device, {
		command: 'ps -o lstart= -p "$NS_SERVICE_PID"',
		cwd,
		env: { NS_SERVICE_PID: String(pid) },
		logPath: DEV_NULL,
		signal: AbortSignal.timeout(PROBE_MS),
		onOutput: (stream, text) => {
			if (stream === "stdout") out += text;
		},
	});
	const started = out.trim();
	return result.exitCode === 0 && started !== "" ? started : null;
}

/** The end of a file, or "" when there is none. */
function readTail(path: string): string {
	let fd: number;
	try {
		fd = openSync(path, "r");
	} catch {
		return "";
	}
	try {
		const size = statSync(path).size;
		const length = Math.min(size, TAIL_READ_BYTES);
		const buffer = Buffer.alloc(length);
		readSync(fd, buffer, 0, length, size - length);
		return buffer.toString("utf8").replace(/^�+/, "");
	} finally {
		closeSync(fd);
	}
}

function minutesText(minutes: number): string {
	return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Waits `ms`, or less when the signal aborts. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal.aborted) return resolve();
		const timer = setTimeout(done, ms);
		function done() {
			clearTimeout(timer);
			signal.removeEventListener("abort", done);
			resolve();
		}
		signal.addEventListener("abort", done, { once: true });
	});
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
