import type { DesktopNotice, DesktopNotifier } from "./desktop";
import { bunPrograms, type Programs, type RunningProgram } from "./programs";

/**
 * The desktop notification through the OS programs, for a daemon that runs
 * outside the desktop app (`bun run night`, `nightshift serve`). What each
 * OS allows:
 *
 * | OS | Program | A click | Withdraw |
 * | --- | --- | --- | --- |
 * | macOS | `terminal-notifier`, when it is on PATH | Opens the page in the browser | Yes (`-remove`) |
 * | macOS | `osascript` (always there) | Opens Script Editor: macOS gives the click to the program that posted it | No |
 * | Linux | `notify-send` (libnotify 0.7.9 or later), with a desktop session | Opens the page with `xdg-open` | Yes, with `gdbus` (`CloseNotification`) |
 * | Linux | an older `notify-send` | Nothing | No |
 *
 * Windows, and Linux without a desktop session (no DISPLAY and no
 * WAYLAND_DISPLAY), get no desktop notification: `systemDesktopNotifier`
 * returns null.
 */

const APP_NAME = "Night Shift";

export type SystemDesktopOptions = {
	/** Turns a path of the web app (`/inbox`) into the address a click opens. */
	pageUrl(path: string): string;
	platform?: NodeJS.Platform;
	env?: Readonly<Record<string, string | undefined>>;
	programs?: Programs;
	onError?: (message: string, error: unknown) => void;
};

/** The desktop notification of this OS, or null when this computer has no desktop to show it on. */
export function systemDesktopNotifier(
	options: SystemDesktopOptions,
): DesktopNotifier | null {
	const platform = options.platform ?? process.platform;
	const env = options.env ?? process.env;
	const programs = options.programs ?? bunPrograms();
	const onError =
		options.onError ??
		((message: string, error: unknown) =>
			console.warn(`[notifications] ${message}`, error));

	if (platform === "darwin") {
		const notifier = programs.which("terminal-notifier");
		if (notifier) return terminalNotifier(notifier, programs, options.pageUrl);
		const osascript = programs.which("osascript");
		return osascript ? appleScript(osascript, programs) : null;
	}
	if (platform === "linux") {
		if (!env.DISPLAY && !env.WAYLAND_DISPLAY) return null;
		const notifySend = programs.which("notify-send");
		if (!notifySend) return null;
		return libnotify(notifySend, programs, options.pageUrl, onError);
	}
	return null;
}

/** macOS with `terminal-notifier`: a click opens the page, and a notice can be taken back. */
function terminalNotifier(
	bin: string,
	programs: Programs,
	pageUrl: (path: string) => string,
): DesktopNotifier {
	return {
		async show(notice) {
			programs.spawn([
				bin,
				"-title",
				APP_NAME,
				"-subtitle",
				notice.title,
				"-message",
				notice.body,
				"-group",
				notice.id,
				"-open",
				pageUrl(notice.open),
			]);
		},
		async withdraw(id) {
			programs.spawn([bin, "-remove", id]);
		},
	};
}

/**
 * macOS without `terminal-notifier`: `osascript`. The words go in as
 * arguments, never into the script text.
 */
function appleScript(bin: string, programs: Programs): DesktopNotifier {
	return {
		async show(notice) {
			programs.spawn([
				bin,
				"-e",
				"on run argv",
				"-e",
				"display notification (item 3 of argv) with title (item 1 of argv) subtitle (item 2 of argv)",
				"-e",
				"end run",
				APP_NAME,
				notice.title,
				notice.body,
			]);
		},
		// macOS has no way to take back a notification of `osascript`.
		async withdraw() {},
	};
}

type Shown = {
	program: RunningProgram;
	/** The notification server's id, once `notify-send` printed it. */
	serverId: string | null;
	withdrawn: boolean;
};

/**
 * Linux: `notify-send --wait` stays until the notice closes. It prints the
 * notification's id first, and `default` when the person clicks it.
 */
function libnotify(
	bin: string,
	programs: Programs,
	pageUrl: (path: string) => string,
	onError: (message: string, error: unknown) => void,
): DesktopNotifier {
	const shown = new Map<string, Shown>();
	/** Set once `notify-send` turned the options down: an older libnotify. */
	let plain = false;

	function showPlain(notice: DesktopNotice): void {
		programs.spawn([bin, `--app-name=${APP_NAME}`, notice.title, notice.body]);
	}

	async function follow(notice: DesktopNotice, entry: Shown): Promise<void> {
		let printed = 0;
		for await (const line of entry.program.lines) {
			printed += 1;
			if (entry.serverId === null && /^\d+$/.test(line)) {
				entry.serverId = line;
			} else if (line === "default" && !entry.withdrawn) {
				const xdgOpen = programs.which("xdg-open");
				if (xdgOpen) programs.spawn([xdgOpen, pageUrl(notice.open)]);
			}
		}
		const code = await entry.program.exited;
		if (shown.get(notice.id) === entry) shown.delete(notice.id);
		if (code !== 0 && printed === 0 && !entry.withdrawn) {
			plain = true;
			showPlain(notice);
		}
	}

	async function withdraw(id: string): Promise<void> {
		const entry = shown.get(id);
		if (!entry) return;
		shown.delete(id);
		entry.withdrawn = true;
		const gdbus = programs.which("gdbus");
		if (entry.serverId && gdbus) {
			programs.spawn([
				gdbus,
				"call",
				"--session",
				"--dest=org.freedesktop.Notifications",
				"--object-path=/org/freedesktop/Notifications",
				"--method=org.freedesktop.Notifications.CloseNotification",
				entry.serverId,
			]);
		}
		entry.program.kill();
	}

	return {
		async show(notice) {
			await withdraw(notice.id);
			if (plain) {
				showPlain(notice);
				return;
			}
			const entry: Shown = {
				program: programs.spawn([
					bin,
					`--app-name=${APP_NAME}`,
					"--print-id",
					"--action=default=Open",
					"--wait",
					notice.title,
					notice.body,
				]),
				serverId: null,
				withdrawn: false,
			};
			shown.set(notice.id, entry);
			follow(notice, entry).catch((error) =>
				onError("A desktop notification did not follow its click.", error),
			);
		},
		withdraw,
	};
}
