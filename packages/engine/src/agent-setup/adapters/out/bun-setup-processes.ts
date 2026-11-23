import type { Subprocess } from "bun";

import type { SetupProcesses } from "../../application/ports";
import {
	asksForCode,
	plainText,
	saysSignedIn,
	signInAddress,
	tailOf,
} from "../../domain/setup-output";
import type {
	InstallEnd,
	RunningInstall,
	RunningSignIn,
	SetupFacts,
	SignInEnd,
	SignInSight,
} from "../../domain/setup-runs";

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
/** How long an install may take before Night Shift stops it. */
export const INSTALL_TIMEOUT_MS = 10 * 60_000;
/** How long a sign-in may take before Night Shift stops it. */
export const SIGN_IN_TIMEOUT_MS = 10 * 60_000;
/** How much of the installer's output a failed install keeps for the person. */
const OUTPUT_TAIL_CHARS = 2_000;
/** How much output the install keeps while it runs: the tail comes from it. */
const OUTPUT_KEPT_CHARS = 32_000;
/** How much output the reader keeps to find an address or a question in. */
const READ_CHARS = 16_000;
/** After the CLI says it signed in, how long it may wait for a key before it is stopped. */
const AFTER_SUCCESS_MS = 5_000;

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
			if (proc.exitCode === null && proc.signalCode === null) {
				proc.kill(name);
			}
		}
	};
	signal("SIGTERM");
	setTimeout(() => signal("SIGKILL"), KILL_AFTER_MS).unref();
}

/**
 * Starts an install in the home folder: `command`, the exact text the
 * person read, with `extraEnv` on top of `env`. Throws when it cannot start.
 */
export function startInstall(input: {
	command: string;
	extraEnv?: Readonly<Record<string, string>>;
	spawn: SetupSpawn;
	home: string;
	env: Readonly<Record<string, string | undefined>>;
	timeoutMs?: number;
}): RunningInstall {
	const { command, spawn, home, env } = input;
	let output = "";
	let stopped: "timeout" | "stop" | null = null;
	const proc = spawn(["/bin/sh", "-c", command], {
		cwd: home,
		env: { ...env, ...input.extraEnv },
		io: "pipes",
		input: false,
		onOutput: (text) => {
			output = (output + text).slice(-OUTPUT_KEPT_CHARS);
		},
	});
	const timer = setTimeout(() => {
		stopped = "timeout";
		proc.stop();
	}, input.timeoutMs ?? INSTALL_TIMEOUT_MS);
	const tail = () => tailOf(plainText(output), OUTPUT_TAIL_CHARS);
	const ended = proc.exited.then(
		(code): InstallEnd => {
			clearTimeout(timer);
			if (stopped === "stop") return { kind: "stopped" };
			if (stopped === "timeout") return { kind: "timed-out", output: tail() };
			return code === 0
				? { kind: "done", output: tail() }
				: { kind: "failed", code, output: tail() };
		},
		(): InstallEnd => {
			clearTimeout(timer);
			return { kind: "failed", code: -1, output: tail() };
		},
	);
	return {
		stop: () => {
			if (stopped) return;
			stopped = "stop";
			proc.stop();
		},
		ended,
	};
}

/**
 * Starts the CLI's sign-in in the home folder, with pipes or in a terminal
 * of its own (`setup.signInIo`). `onSight` hears each change of what it
 * shows. Throws when the CLI cannot start.
 */
export function startSignIn(input: {
	program: string;
	setup: SetupFacts;
	spawn: SetupSpawn;
	home: string;
	env: Readonly<Record<string, string | undefined>>;
	onSight(sight: SignInSight): void;
	timeoutMs?: number;
}): RunningSignIn {
	const { setup, spawn } = input;
	const enter = setup.signInIo === "terminal" ? "\r" : "\n";
	let output = "";
	let sight: SignInSight = { url: null, codeNeeded: false };
	let stopped: "timeout" | "stop" | null = null;
	let afterSuccess: Timer | null = null;
	let proc: SetupProcess | null = null;

	const read = (text: string) => {
		output = (output + text).slice(-READ_CHARS);
		const plain = plainText(output);
		const next: SignInSight = {
			url: sight.url ?? signInAddress(plain, setup.signInHosts),
			codeNeeded: sight.codeNeeded || asksForCode(plain),
		};
		if (next.url !== sight.url || next.codeNeeded !== sight.codeNeeded) {
			sight = next;
			input.onSight(sight);
		}
		if (!afterSuccess && saysSignedIn(plain)) {
			proc?.write(enter);
			afterSuccess = setTimeout(() => proc?.stop(), AFTER_SUCCESS_MS);
		}
	};

	const started = spawn([input.program, ...setup.signIn], {
		cwd: input.home,
		env: { ...input.env, NO_COLOR: "1" },
		io: setup.signInIo,
		input: true,
		onOutput: read,
	});
	proc = started;
	const timer = setTimeout(() => {
		stopped = "timeout";
		started.stop();
	}, input.timeoutMs ?? SIGN_IN_TIMEOUT_MS);
	const end = (): void => {
		clearTimeout(timer);
		if (afterSuccess) clearTimeout(afterSuccess);
		output = "";
	};
	const ended = started.exited.then(
		(code): SignInEnd => {
			end();
			if (stopped === "stop") return { kind: "stopped" };
			if (stopped === "timeout") return { kind: "timed-out" };
			return { kind: "exited", code };
		},
		(): SignInEnd => {
			end();
			return { kind: "exited", code: -1 };
		},
	);
	return {
		sendCode: (code) => {
			output = "";
			if (sight.codeNeeded) {
				sight = { ...sight, codeNeeded: false };
				input.onSight(sight);
			}
			started.write(`${code}${enter}`);
		},
		stop: () => {
			if (stopped) return;
			stopped = "stop";
			started.stop();
		},
		ended,
	};
}

/** Setup processes over a spawn: Bun in production, a fake in a test. */
export function setupProcessesOver(
	spawn: SetupSpawn,
	timeouts: { installTimeoutMs?: number; signInTimeoutMs?: number } = {},
): SetupProcesses {
	return {
		startInstall: (input) =>
			startInstall({
				...input,
				spawn,
				timeoutMs: input.timeoutMs ?? timeouts.installTimeoutMs,
			}),
		startSignIn: (input) =>
			startSignIn({
				...input,
				spawn,
				timeoutMs: input.timeoutMs ?? timeouts.signInTimeoutMs,
			}),
	};
}

export function bunSetupProcesses(
	timeouts: { installTimeoutMs?: number; signInTimeoutMs?: number } = {},
): SetupProcesses {
	return setupProcessesOver(systemSpawn, timeouts);
}
