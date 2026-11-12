import type { Subprocess } from "bun";

/**
 * How the guided setup starts a program: the vendor's installer, or the
 * CLI's sign-in. A port, so a test gives a fake and never runs a real
 * installer or a real sign-in. `systemSpawn` is the adapter over Bun.
 */

/** One program the setup started. */
export type SetupProcess = {
	/** Writes to its input (a sign-in code). Nothing happens when its input is closed. */
	write(text: string): void;
	/** Stops it, and every program it started. */
	stop(): void;
	/** Its exit code, once it ended and its output is read. */
	exited: Promise<number>;
};

export type SetupSpawnOptions = {
	cwd: string;
	env: Readonly<Record<string, string | undefined>>;
	/**
	 * Plain pipes, or a terminal of its own (Bun's `terminal`) for a CLI
	 * that refuses to sign in without one.
	 */
	io: "pipes" | "terminal";
	/** The program reads input (a sign-in code). False: its input is closed. */
	input: boolean;
	/** Each piece of its output as it comes, the error output too. */
	onOutput(text: string): void;
};

export type SetupSpawn = (
	argv: readonly string[],
	options: SetupSpawnOptions,
) => SetupProcess;

/** How long the output may still come after the program ended. */
const DRAIN_MS = 1_000;
/** How long a stopped program has before it is killed. */
const KILL_AFTER_MS = 3_000;

/**
 * Bun's spawn. With pipes, the program starts in a session of its own
 * (`detached`): it has no terminal to ask a question on, and `stop` ends
 * its whole process group. A terminal (`io: "terminal"`) is a session of
 * its own too. Its width keeps a long sign-in address on one line.
 */
export const systemSpawn: SetupSpawn = (argv, options) => {
	const decoder = new TextDecoder();
	const env = { ...options.env };
	if (options.io === "terminal") {
		const proc = Bun.spawn([...argv], {
			cwd: options.cwd,
			env,
			terminal: {
				cols: 4096,
				rows: 40,
				data: (_terminal, data) =>
					options.onOutput(decoder.decode(data, { stream: true })),
			},
		});
		return {
			write: (text) => {
				if (proc.terminal && !proc.terminal.closed) proc.terminal.write(text);
			},
			stop: () => stopGroup(proc),
			exited: proc.exited.then((code) => {
				proc.terminal?.close();
				return code;
			}),
		};
	}
	const read = async (stream: ReadableStream<Uint8Array>) => {
		const own = new TextDecoder();
		for await (const chunk of stream) {
			options.onOutput(own.decode(chunk, { stream: true }));
		}
	};
	const finish = async (proc: {
		stdout: ReadableStream<Uint8Array>;
		stderr: ReadableStream<Uint8Array>;
		exited: Promise<number>;
	}): Promise<number> => {
		const reading = Promise.all([read(proc.stdout), read(proc.stderr)]);
		const code = await proc.exited;
		// A program it started may hold the output open: wait a moment only.
		await Promise.race([reading.catch(() => {}), Bun.sleep(DRAIN_MS)]);
		return code;
	};
	if (options.input) {
		const proc = Bun.spawn([...argv], {
			cwd: options.cwd,
			env,
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
			detached: true,
		});
		return {
			write: (text) => {
				try {
					proc.stdin.write(text);
					proc.stdin.flush();
				} catch {
					// Its input is closed: it ended, or stopped reading.
				}
			},
			stop: () => stopGroup(proc),
			exited: finish(proc),
		};
	}
	const proc = Bun.spawn([...argv], {
		cwd: options.cwd,
		env,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		detached: true,
	});
	return {
		write: () => {},
		stop: () => stopGroup(proc),
		exited: finish(proc),
	};
};

/** Ends the process group the program leads, then kills what is left of it. */
function stopGroup(proc: Subprocess): void {
	const signal = (name: "SIGTERM" | "SIGKILL") => {
		try {
			process.kill(-proc.pid, name);
		} catch {
			// The group is gone, or the program leads none: stop it alone.
			if (proc.exitCode === null && proc.signalCode === null) {
				proc.kill(name);
			}
		}
	};
	signal("SIGTERM");
	setTimeout(() => signal("SIGKILL"), KILL_AFTER_MS).unref();
}
