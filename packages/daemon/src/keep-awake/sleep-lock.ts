/**
 * The OS's sleep lock, behind a port. While a hold lives, this computer
 * does not go to sleep on its own. Each hold is a program that runs until
 * it is killed, and that also ends when the daemon's process ends, so a
 * daemon that crashes never keeps the computer awake:
 *
 * - macOS: `caffeinate -i -w <pid>` (no idle sleep while the daemon lives).
 * - Linux: `systemd-inhibit --what=idle:sleep --mode=block` around
 *   `tail --pid=<pid> -f /dev/null`.
 * - Windows and other systems: no lock (`systemSleepLock` returns null).
 */

/** A program that runs. */
export type HeldProgram = {
	exited: Promise<number>;
	kill(): void;
};

/** The port to the programs of this computer. */
export type LockPrograms = {
	which(name: string): string | null;
	spawn(command: readonly string[]): HeldProgram;
};

/** One hold of the lock. */
export type SleepHold = {
	/** Resolves when the hold ends: released, or its program ended on its own. */
	ended: Promise<void>;
	release(): void;
};

export type SleepLock = {
	/** Holds the lock until `release`. */
	acquire(): SleepHold;
};

const WHO = "Night Shift";
const WHY = "A run is running";

/** The sleep lock of this OS, or null when Night Shift has none for it. */
export function systemSleepLock(
	options: {
		platform?: NodeJS.Platform;
		pid?: number;
		programs?: LockPrograms;
	} = {},
): SleepLock | null {
	const platform = options.platform ?? process.platform;
	const pid = String(options.pid ?? process.pid);
	const programs = options.programs ?? bunLockPrograms();

	let command: string[] | null = null;
	if (platform === "darwin") {
		const caffeinate = programs.which("caffeinate");
		if (caffeinate) command = [caffeinate, "-i", "-w", pid];
	} else if (platform === "linux") {
		const inhibit = programs.which("systemd-inhibit");
		const tail = programs.which("tail");
		if (inhibit && tail) {
			command = [
				inhibit,
				"--what=idle:sleep",
				`--who=${WHO}`,
				`--why=${WHY}`,
				"--mode=block",
				tail,
				`--pid=${pid}`,
				"-f",
				"/dev/null",
			];
		}
	}
	if (!command) return null;
	const held = command;
	return {
		acquire() {
			const program = programs.spawn(held);
			return {
				ended: program.exited.then(
					() => {},
					() => {},
				),
				release: () => program.kill(),
			};
		},
	};
}

function bunLockPrograms(): LockPrograms {
	return {
		which: (name) => Bun.which(name),
		spawn(command) {
			const child = Bun.spawn([...command], {
				stdin: "ignore",
				stdout: "ignore",
				stderr: "ignore",
			});
			return { exited: child.exited, kill: () => child.kill() };
		},
	};
}
