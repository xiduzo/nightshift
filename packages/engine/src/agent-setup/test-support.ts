import type { SetupSpawn, SetupSpawnOptions } from "./spawn";

/** One program a test's fake spawn started: what it got, and its controls. */
export type FakeProcess = {
	argv: string[];
	options: SetupSpawnOptions;
	/** What the setup wrote to its input. */
	written: string[];
	stopped: boolean;
	/** Prints output, as the program would. */
	print(text: string): void;
	/** Ends it with an exit code. */
	exit(code: number): void;
};

/**
 * A spawn that starts nothing: each call is a `FakeProcess` the test
 * drives. `onStart` runs as each one starts. No real installer and no real
 * sign-in ever runs in a test.
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
