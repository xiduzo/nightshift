import type { SetupProcesses } from "../../application/ports";
import { type SetupSpawn, setupProcessesOver } from "./bun-setup-processes";

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

/** Setup processes over a fake spawn, for use-case tests and the contract. */
export function inMemorySetupProcesses(
	onStart: (proc: FakeProcess) => void = () => {},
	timeouts: { installTimeoutMs?: number; signInTimeoutMs?: number } = {},
): SetupProcesses & { started: FakeProcess[]; spawn: SetupSpawn } {
	const { spawn, started } = fakeSpawn(onStart);
	return { ...setupProcessesOver(spawn, timeouts), started, spawn };
}
