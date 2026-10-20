/**
 * systemd's service notifications (sd_notify), for `nightshift serve` under
 * `deploy/nightshift.service`: READY=1 once it serves, then WATCHDOG=1 at
 * half the watchdog time. When the pings stop, systemd kills the daemon
 * and starts it again. The pings come from `setInterval` on purpose: when
 * the daemon's timers stop, so do the pings.
 *
 * Bun has no Unix datagram socket, so each message spawns `systemd-notify`
 * (no maintained package does this for Bun without a native addon). The
 * message then comes from a child process: the unit sets
 * `NotifyAccess=all`, and `systemd-notify` waits until systemd processed
 * it (no `--no-block`), so systemd can still tell which unit it is for.
 * Outside systemd (no NOTIFY_SOCKET) nothing happens.
 */

type Env = Record<string, string | undefined>;
type Spawn = (command: string[]) => void;

const spawnNotify: Spawn = (command) => {
	Bun.spawn(command, { stdout: "ignore", stderr: "inherit" });
};

/** Sends READY=1, and starts the watchdog pings when the unit has a watchdog. */
export function notifySystemd(
	options: { env?: Env; spawn?: Spawn } = {},
): Timer | null {
	const env = options.env ?? process.env;
	const spawn = options.spawn ?? spawnNotify;
	if (!env.NOTIFY_SOCKET) return null;
	const send = (message: string) => {
		try {
			spawn(["systemd-notify", message]);
		} catch (error) {
			console.error(`systemd-notify ${message} failed:`, error);
		}
	};
	send("--ready");
	// WatchdogSec, in microseconds.
	const watchdogMs = Number(env.WATCHDOG_USEC) / 1_000;
	if (!(watchdogMs > 0)) return null;
	const timer = setInterval(() => send("WATCHDOG=1"), watchdogMs / 2);
	timer.unref();
	return timer;
}
