import type { DesktopNotice, DesktopNotifier } from "../desktop";
import type { Programs, RunningProgram } from "../desktop/programs";

export type FakeDesktopNotifier = DesktopNotifier & {
	/** The notices shown, in order. */
	shown: DesktopNotice[];
	/** The ids withdrawn, in order. */
	withdrawn: string[];
};

/** A desktop notifier that records what it shows and takes back. */
export function fakeDesktopNotifier(): FakeDesktopNotifier {
	const shown: DesktopNotice[] = [];
	const withdrawn: string[] = [];
	return {
		shown,
		withdrawn,
		async show(notice) {
			shown.push(notice);
		},
		async withdraw(id) {
			withdrawn.push(id);
		},
	};
}

/** A program the fake started: the test prints its lines and ends it. */
export type FakeProgram = RunningProgram & {
	command: readonly string[];
	killed: boolean;
	print(line: string): void;
	exit(code: number): void;
};

export type FakePrograms = Programs & {
	/** Every program started, in order. */
	started: FakeProgram[];
	/** The commands started, in order. */
	commands(): string[][];
};

/** Programs that run nothing: `installed` names the ones on PATH (at `/bin/<name>`). */
export function fakePrograms(installed: readonly string[]): FakePrograms {
	const started: FakeProgram[] = [];
	return {
		started,
		commands: () => started.map((p) => [...p.command]),
		which: (name) => (installed.includes(name) ? `/bin/${name}` : null),
		spawn(command) {
			const queue: string[] = [];
			let wake: (() => void) | null = null;
			let done = false;
			let resolveExit: (code: number) => void = () => {};
			const exited = new Promise<number>((resolve) => {
				resolveExit = resolve;
			});
			const poke = () => {
				const resolve = wake;
				wake = null;
				resolve?.();
			};
			const program: FakeProgram = {
				command,
				killed: false,
				exited,
				lines: (async function* () {
					while (true) {
						const line = queue.shift();
						if (line !== undefined) {
							yield line;
							continue;
						}
						if (done) return;
						await new Promise<void>((resolve) => {
							wake = resolve;
						});
					}
				})(),
				print(line) {
					queue.push(line);
					poke();
				},
				exit(code) {
					done = true;
					resolveExit(code);
					poke();
				},
				kill() {
					program.killed = true;
					program.exit(143);
				},
			};
			started.push(program);
			return program;
		},
	};
}
