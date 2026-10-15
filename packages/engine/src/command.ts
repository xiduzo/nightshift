import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { dirname } from "node:path";

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
 * Runs `sh -c <command>` in `cwd` in its own process group. Streams every
 * chunk of stdout and stderr to `onOutput` and to the log file. Aborting the
 * signal kills the whole group (SIGTERM, then SIGKILL). Never throws.
 */
export function runCommand(input: {
	command: string;
	cwd: string;
	/** Added to the daemon's environment. */
	env?: Record<string, string>;
	logPath: string;
	signal: AbortSignal;
	onOutput: (stream: "stdout" | "stderr", text: string) => void;
}): Promise<CommandResult> {
	const { command, cwd, env, logPath, signal, onOutput } = input;
	mkdirSync(dirname(logPath), { recursive: true });
	const log = openSync(logPath, "a");
	let buffer = "";
	const timers: ReturnType<typeof setTimeout>[] = [];

	return new Promise<CommandResult>((resolve) => {
		let settled = false;
		const finish = (result: Omit<CommandResult, "logTail">) => {
			if (settled) return;
			settled = true;
			for (const timer of timers) clearTimeout(timer);
			signal.removeEventListener("abort", onAbort);
			closeSync(log);
			resolve({ ...result, logTail: tailOf(buffer) });
		};

		let child: ReturnType<typeof spawn>;
		try {
			child = spawn("sh", ["-c", command], {
				cwd,
				env: { ...process.env, ...env },
				detached: true,
				stdio: ["ignore", "pipe", "pipe"],
			});
		} catch (error) {
			finish({ exitCode: null, spawnError: messageOf(error) });
			return;
		}

		const killGroup = (sig: NodeJS.Signals) => {
			if (child.pid === undefined) return;
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
					timers.push(
						setTimeout(
							() => finish({ exitCode: null, spawnError: null }),
							ABANDON_MS,
						),
					);
				}, KILL_GRACE_MS),
			);
		}

		const handle = (stream: "stdout" | "stderr") => (text: string) => {
			if (settled) return;
			writeSync(log, text);
			buffer = (buffer + text).slice(-TAIL_BUFFER_CHARS);
			onOutput(stream, text);
		};
		child.stdout?.setEncoding("utf8");
		child.stderr?.setEncoding("utf8");
		child.stdout?.on("data", handle("stdout"));
		child.stderr?.on("data", handle("stderr"));

		child.on("error", (error) => {
			finish({ exitCode: null, spawnError: messageOf(error) });
		});
		child.on("close", (code) => {
			finish({ exitCode: code, spawnError: null });
		});

		if (signal.aborted) onAbort();
		else signal.addEventListener("abort", onAbort, { once: true });
	});
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
