import type {
	DesktopNotifier,
	DesktopWindow,
	DesktopWindowState,
} from "@nightshift/daemon";

/**
 * The desktop app's own notifications, for the daemon that runs inside
 * it. Electrobun shows them (`Utils.showNotification`), under the app's
 * name and icon. What Electrobun 2 allows:
 *
 * - A click: Electrobun reports none. macOS brings Night Shift to the
 *   front; the window does not move to the Gate or the run. The notice
 *   says where to go ("Open the inbox to answer it.").
 * - Withdraw: Electrobun has no call to take a notification back. It
 *   stays in the Notification Centre after the Gate closes; the inbox no
 *   longer shows the Gate.
 *
 * The window tells the daemon whether it has the focus and which page it
 * shows, from its focus, blur and navigation events. The daemon then shows
 * no notification for what the person already looks at.
 */

/** What Electrobun's `Utils.showNotification` takes. */
type ShowNotification = (options: { title: string; body?: string }) => void;

/** Electrobun's notification as the daemon's desktop port. */
export function electrobunNotifier(show: ShowNotification): DesktopNotifier {
	return {
		async show(notice) {
			show({ title: notice.title, body: notice.body });
		},
		// Electrobun has no call to take a notification back.
		async withdraw() {},
	};
}

/** The main window's state, as its events report it. */
export type WindowTracker = DesktopWindow & {
	/** A window opened, with the focus. */
	opened(): void;
	focused(): void;
	blurred(): void;
	/** It loaded or moved to `url`. */
	navigated(url: string): void;
	closed(): void;
};

export function trackWindow(): WindowTracker {
	let open = false;
	let focus = false;
	let path: string | null = null;
	return {
		state(): DesktopWindowState {
			return { focused: open && focus, path: open ? path : null };
		},
		opened() {
			open = true;
			focus = true;
			path = null;
		},
		focused() {
			focus = true;
		},
		blurred() {
			focus = false;
		},
		navigated(url) {
			path = pathOf(url);
		},
		closed() {
			open = false;
			focus = false;
			path = null;
		},
	};
}

/** The page of a window address: `views://mainview/inbox?gate=x` is `/inbox`. */
function pathOf(url: string): string | null {
	try {
		return new URL(url).pathname || "/";
	} catch {
		return null;
	}
}
