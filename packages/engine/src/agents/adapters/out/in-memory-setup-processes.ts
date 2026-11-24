import type { SetupProcesses } from "../../application/ports";
import {
	asksForCode,
	plainText,
	signInAddress,
} from "../../domain/setup-output";
import type { SignInSight } from "../../domain/setup-runs";
import type { SetupSpawn } from "./bun-setup-processes";

/** One program a test's fake spawn started: what it got, and its controls. */
export type FakeProcess = {
	argv: string[];
	options: {
		cwd: string;
		env: Readonly<Record<string, string | undefined>>;
		io: "pipes" | "terminal";
		input: boolean;
		onOutput(text: string): void;
	};
	written: string[];
	stopped: boolean;
	print(text: string): void;
	exit(code: number): void;
};

/**
 * A spawn that starts nothing: each call is a `FakeProcess` the test
 * drives. No real installer and no real sign-in ever runs in a test.
 */
export function fakeSpawn(onStart: (proc: FakeProcess) => void = () => {}) {
	const started: FakeProcess[] = [];
	const spawn: SetupSpawn = (argv, options) => {
		let end: (code: number) => void = () => {};
		const exited = new Promise<number>((resolve) => {
			end = resolve;
		});
		const proc: FakeProcess = {
			argv: [...argv],
			options,
			written: [],
			stopped: false,
			print: (text) => options.onOutput(text),
			exit: (code) => end(code),
		};
		started.push(proc);
		onStart(proc);
		return {
			write: (text) => {
				proc.written.push(text);
			},
			stop: () => {
				proc.stopped = true;
				end(143);
			},
			exited,
		};
	};
	return { spawn, started };
}

/** An exit code, or why the program was stopped before it ended. */
type End = number | "stopped" | "timed-out";

/** Runs a fake program until it exits, `stop` is called or its time is over. */
function running(
	proc: FakeProcess,
	exited: Promise<number>,
	timeoutMs = 60_000,
) {
	let why: "stopped" | "timed-out" | null = null;
	const stop = (reason: "stopped" | "timed-out") => {
		why ??= reason;
		proc.stopped = true;
		proc.exit(143);
	};
	const timer = setTimeout(() => stop("timed-out"), timeoutMs);
	const ended = exited.then((code): End => {
		clearTimeout(timer);
		return why ?? code;
	});
	return { stop: () => stop("stopped"), ended };
}

/**
 * The setup processes in memory: each start is a `FakeProcess` that a test
 * prints in and ends. It starts no program.
 */
export function inMemorySetupProcesses() {
	const started: FakeProcess[] = [];
	const start = (
		argv: string[],
		options: Omit<FakeProcess["options"], "cwd" | "io" | "onOutput">,
		home: string,
		timeoutMs?: number,
	) => {
		let output = "";
		let heard = () => {};
		const { spawn, started: one } = fakeSpawn();
		const { exited } = spawn(argv, {
			...options,
			cwd: home,
			io: "pipes",
			onOutput: (text) => {
				output += text;
				heard();
			},
		});
		const [proc] = one;
		if (!proc) throw new Error("The fake program did not start.");
		started.push(proc);
		return {
			...running(proc, exited, timeoutMs),
			proc,
			text: () => plainText(output),
			onText: (listener: () => void) => {
				heard = listener;
			},
		};
	};
	const twin: SetupProcesses & { started: FakeProcess[] } = {
		started,
		startInstall({ command, extraEnv, home, env, timeoutMs }) {
			const run = start(
				["/bin/sh", "-c", command],
				{ env: { ...env, ...extraEnv }, input: false },
				home,
				timeoutMs,
			);
			return {
				stop: run.stop,
				ended: run.ended.then((end) => {
					const output = run.text().trim();
					if (end === "stopped") return { kind: "stopped" };
					if (end === "timed-out") return { kind: "timed-out", output };
					if (end === 0) return { kind: "done", output };
					return { kind: "failed", code: end, output };
				}),
			};
		},
		startSignIn({ program, setup, home, env, onSight, timeoutMs }) {
			const run = start(
				[program, ...setup.signIn],
				{ env, input: true },
				home,
				timeoutMs,
			);
			let sight: SignInSight = { url: null, codeNeeded: false };
			const show = (next: SignInSight) => {
				if (next.url === sight.url && next.codeNeeded === sight.codeNeeded)
					return;
				sight = next;
				onSight(sight);
			};
			run.onText(() =>
				show({
					url: signInAddress(run.text(), setup.signInHosts),
					codeNeeded: asksForCode(run.text()),
				}),
			);
			return {
				sendCode: (code) => {
					run.proc.written.push(code);
					show({ ...sight, codeNeeded: false });
				},
				stop: run.stop,
				ended: run.ended.then((end) =>
					typeof end === "number"
						? { kind: "exited", code: end }
						: { kind: end },
				),
			};
		},
	};
	return twin;
}
