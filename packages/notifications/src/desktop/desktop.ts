import type {
	NotificationChannel,
	NotificationMessage,
	SendResult,
} from "../channels";
import type { PushTarget } from "../targets";

/**
 * The desktop notification: a native notification on this computer, from
 * the daemon that runs here. Two ports stand between it and the OS:
 *
 * - `DesktopNotifier` shows and takes back one notification. The desktop
 *   app fills it with Electrobun's own notification when the daemon runs
 *   inside it; `systemDesktopNotifier` fills it with the OS programs when
 *   the daemon runs alone (`bun run night`, `nightshift serve`).
 * - `DesktopWindow` says what the desktop app's window shows, when the
 *   daemon runs inside the app and can know it.
 *
 * The desktop target is this computer's own screen: its endpoint is this
 * Device's id, and the daemon registers it for the computer's owner when
 * it starts. A local notification is not a second push sender, so the
 * notifier may show it for every Space this computer has (see
 * `notifier.ts`).
 */

/** One notification on this computer's desktop. */
export type DesktopNotice = {
	/** The event key. A later notice with the same id replaces it, and `withdraw` takes it back. */
	id: string;
	title: string;
	body: string;
	/** Where a click opens Night Shift: a path of the web app (`/inbox?gate=…`, `/runs/…`). */
	open: string;
};

/** The OS port: shows and takes back native notifications on this computer. */
export type DesktopNotifier = {
	show(notice: DesktopNotice): Promise<void>;
	/** Takes the notification back, where the OS allows it. Best effort: never throws. */
	withdraw(id: string): Promise<void>;
};

/** What the desktop app's window shows now. */
export type DesktopWindowState = {
	/** The window is open and has the focus. False: it is closed, or behind another window. */
	focused: boolean;
	/** The path of the page it shows (`/inbox`). Null: it did not say. */
	path: string | null;
};

/** The desktop app's window, as the daemon inside the app sees it. */
export type DesktopWindow = {
	/** Null: the window state is not known here. */
	state(): DesktopWindowState | null;
};

export type DesktopChannelOptions = {
	/** This computer's Device id: the endpoint of its desktop target. */
	deviceId: string;
	notifier: DesktopNotifier;
	/** The app's window. Absent: the daemon runs outside the desktop app. */
	window?: DesktopWindow;
	/** Whether the Person has a Night Shift page open on this computer (an in-app stream from here). */
	streamHere(personId: string): boolean;
};

/**
 * The desktop channel. It reaches only this computer: a desktop target
 * of another computer is gone here. It shows nothing when the person
 * already looks at what the notification would open:
 *
 * - When the window state is known: the window has the focus and shows
 *   the inbox (a Gate), or the run (a run that ended). A window that is
 *   closed or behind another one shows nothing.
 * - Else (no window state, or a focused window that did not say its
 *   page): the person has a Night Shift page open on this computer, and
 *   that page showed it (`toldInApp`). A page that only updated (a Space
 *   another Host sends for, quiet hours) shows no notification of its own.
 */
export function createDesktopChannel(
	options: DesktopChannelOptions,
): NotificationChannel<PushTarget> {
	return {
		async send(target, message): Promise<SendResult> {
			if (target.endpoint !== options.deviceId) return "gone";
			if (onScreen(options, target.personId, message)) return "sent";
			await options.notifier.show(noticeOf(message));
			return "sent";
		},
		async withdraw(target, key) {
			if (target.endpoint !== options.deviceId) return;
			await options.notifier.withdraw(key);
		},
	};
}

/** Whether the person already sees what the notification would open. */
function onScreen(
	options: DesktopChannelOptions,
	personId: string,
	message: NotificationMessage,
): boolean {
	const state = options.window?.state() ?? null;
	if (state && !state.focused) return false;
	if (state && state.path !== null) {
		const path = state.path.replace(/\/+$/, "") || "/";
		if (message.kind === "gate-opened" || message.kind === "gates-waiting") {
			return path === "/inbox";
		}
		return message.runId !== null && path === `/runs/${message.runId}`;
	}
	// A page here shows it only when its in-app item alerted.
	return message.toldInApp === true && options.streamHere(personId);
}

/** What the notification says, and where a click opens Night Shift. */
export function noticeOf(message: NotificationMessage): DesktopNotice {
	const base = { id: message.key, title: message.title };
	switch (message.kind) {
		case "gate-opened":
			return {
				...base,
				body: "Open the inbox to answer it.",
				open: message.stepId
					? `/inbox?gate=${encodeURIComponent(message.stepId)}`
					: "/inbox",
			};
		case "gates-waiting":
			return {
				...base,
				body: "Open the inbox to answer them.",
				open: "/inbox",
			};
		case "run-finished":
			return {
				...base,
				body: "Open the run to see its outcome.",
				open: runPath(message.runId),
			};
		case "run-failed":
			return {
				...base,
				body: "Open the run to see why it failed.",
				open: runPath(message.runId),
			};
	}
}

function runPath(runId: string | null): string {
	return runId ? `/runs/${encodeURIComponent(runId)}` : "/";
}
