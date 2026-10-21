/**
 * The port to the OS programs the desktop notification runs
 * (`terminal-notifier`, `osascript`, `notify-send`, `gdbus`, `xdg-open`).
 * `bunPrograms` runs them; the tests use `fakePrograms` (`./testing`).
 */

/** A program that runs. */
export type RunningProgram = {
	/** What it prints on stdout, line by line, until it exits. */
	lines: AsyncIterable<string>;
	/** Its exit code. */
	exited: Promise<number>;
	kill(): void;
};

export type Programs = {
	/** The path of a program on PATH, or null. */
	which(name: string): string | null;
	/** Starts `command` (no shell). */
	spawn(command: readonly string[]): RunningProgram;
};

/** The programs of this computer, through Bun. */
export function bunPrograms(): Programs {
	return {
		which: (name) => Bun.which(name),
		spawn(command) {
			const child = Bun.spawn([...command], {
				stdin: "ignore",
				stdout: "pipe",
				stderr: "ignore",
			});
			return {
				lines: linesOf(child.stdout),
				exited: child.exited,
				kill: () => child.kill(),
			};
		},
	};
}

async function* linesOf(stream: ReadableStream<Uint8Array>) {
	const decoder = new TextDecoder();
	let rest = "";
	for await (const chunk of stream) {
		rest += decoder.decode(chunk, { stream: true });
		let at = rest.indexOf("\n");
		while (at >= 0) {
			yield rest.slice(0, at).trim();
			rest = rest.slice(at + 1);
			at = rest.indexOf("\n");
		}
	}
	if (rest.trim()) yield rest.trim();
}
