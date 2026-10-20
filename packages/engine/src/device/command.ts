import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { dirname } from "node:path";

import type { Device, ExecEvent, ExecInput } from "./types";

/** How many lines and bytes of output `log_tail` keeps. */
export const LOG_TAIL_LINES = 60;
export const LOG_TAIL_BYTES = 8 * 1024;
/** How much output the runner keeps in memory to cut the tail from. */
const TAIL_BUFFER_CHARS = 64 * 1024;
/** After an abort: SIGTERM, then SIGKILL after this long. */
const KILL_GRACE_MS = 2_000;
/** After SIGKILL, stop waiting for the streams to close. */
const ABANDON_MS = 1_000;

export type CommandResult = {
	/** Null when the process did not exit normally (killed, or never spawned). */
	exitCode: number | null;
	/** Set when the command could not start at all. */
	spawnError: string | null;
	/** The last lines of stdout and stderr together. */
	logTail: string;
};

/** The last `LOG_TAIL_LINES` lines, at most `LOG_TAIL_BYTES` bytes. */
export function tailOf(output: string): string {
	const trimmed = output.endsWith("\n") ? output.slice(0, -1) : output;
	let tail = trimmed.split("\n").slice(-LOG_TAIL_LINES).join("\n");
	const bytes = Buffer.from(tail, "utf8");
	if (bytes.length > LOG_TAIL_BYTES) {
		// Cut on a byte boundary, then drop a split character at the start.
		tail = bytes
			.subarray(bytes.length - LOG_TAIL_BYTES)
			.toString("utf8")
			.replace(/^�+/, "");
	}
	return tail;
}

/**
 * Runs one command on `device` for a step: every chunk of stdout and
 * stderr goes to `onOutput` and to the log file at `logPath` (on the
 * computer that walks the run), and the result keeps the tail. Never
 * throws: a Device that fails reads as a command that could not start.
 */
export async function runCommand(
	device: Pick<Device, "exec">,
	input: ExecInput & {
		logPath: string;
		onOutput: (stream: "stdout" | "stderr", text: string) => void;
	},
): Promise<CommandResult> {
	const { logPath, onOutput, ...command } = input;
	mkdirSync(dirname(logPath), { recursive: true });
	const log = openSync(logPath, "a");
	let buffer = "";
	let exit: Omit<CommandResult, "logTail"> = {
		exitCode: null,
		spawnError: null,
	};
	try {
		for await (const event of device.exec(command)) {
			if (event.type === "exit") {
				exit = { exitCode: event.exitCode, spawnError: event.spawnError };
				break;
			}
			writeSync(log, event.text);
			buffer = (buffer + event.text).slice(-TAIL_BUFFER_CHARS);
			onOutput(event.stream, event.text);
		}
	} catch (error) {
		exit = { exitCode: null, spawnError: messageOf(error) };
	} finally {
		closeSync(log);
	}
	return { ...exit, logTail: tailOf(buffer) };
}

/**
 * The local adapter of `Device.exec`: `sh -c <command>` in `cwd` in its
 * own process group. Yields every chunk of stdout and stderr, then one
 * `exit`. Aborting the signal kills the whole group (SIGTERM, then
 * SIGKILL). Never throws.
 */
export async function* spawnCommand(
	input: ExecInput,
): AsyncGenerator<ExecEvent> {
	const { command, cwd, env, signal } = input;
	const queue: ExecEvent[] = [];
	let wake: (() => void) | null = null;
	const push = (event: ExecEvent) => {
		queue.push(event);
		const resolve = wake;
		wake = null;
		resolve?.();
	};
	const timers: ReturnType<typeof setTimeout>[] = [];
	let settled = false;
	const finish = (exitCode: number | null, spawnError: string | null) => {
		if (settled) return;
		settled = true;
		for (const timer of timers) clearTimeout(timer);
		signal.removeEventListener("abort", onAbort);
		push({ type: "exit", exitCode, spawnError });
	};

	let child: ReturnType<typeof spawn> | undefined;
	const killGroup = (sig: NodeJS.Signals) => {
		if (child?.pid === undefined) return;
		try {
			process.kill(-child.pid, sig);
		} catch {
			try {
				child.kill(sig);
			} catch {
				// Already gone.
			}
		}
	};
	function onAbort() {
		killGroup("SIGTERM");
		timers.push(
			setTimeout(() => {
				killGroup("SIGKILL");
				timers.push(setTimeout(() => finish(null, null), ABANDON_MS));
			}, KILL_GRACE_MS),
		);
	}

	try {
		child = spawn("sh", ["-c", command], {
			cwd,
			env: { ...process.env, ...env },
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch (error) {
		finish(null, messageOf(error));
	}

	if (child) {
		const handle = (stream: "stdout" | "stderr") => (text: string) => {
			if (!settled) push({ type: "output", stream, text });
		};
		child.stdout?.setEncoding("utf8");
		child.stderr?.setEncoding("utf8");
		child.stdout?.on("data", handle("stdout"));
		child.stderr?.on("data", handle("stderr"));
		child.on("error", (error) => finish(null, messageOf(error)));
		child.on("close", (code) => finish(code, null));
		if (signal.aborted) onAbort();
		else signal.addEventListener("abort", onAbort, { once: true });
	}

	try {
		while (true) {
			const event = queue.shift();
			if (event === undefined) {
				await new Promise<void>((resolve) => {
					wake = resolve;
				});
				continue;
			}
			yield event;
			if (event.type === "exit") return;
		}
	} finally {
		// The reader stopped early: the command does not outlive it.
		if (!settled) {
			killGroup("SIGKILL");
			finish(null, null);
		}
	}
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
