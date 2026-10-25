import type { PushData, PushRoute, ShownNotification } from "../notifications";

/**
 * Something the person should see now: an item of the notifications
 * stream with `alert`. A Gate opened, a run finished, a run failed.
 */
export type Notice = {
	/** What a push of the same key carries: what happened, its key, its Space, run and step. */
	data: PushData;
	/** Where a tap goes. */
	route: PushRoute;
	/** The Host's one short sentence, the same as a push says: "A Gate waits for you". */
	title: string;
	/**
	 * The longer words: the project, the run, the question. Read from the
	 * Host when this screen can, else the short sentence.
	 */
	describe(): Promise<{ title: string; body?: string }>;
};

/** A notification this screen shows now, and how to take it away. */
export type ListedNotification = ShownNotification & {
	dismiss(): Promise<void> | void;
};

/**
 * How one screen shows notifications: the seam between the live cache and
 * a platform. The browser adapter (`apps/web`) shows a toast or a
 * notification of this computer. The phone adapter (`apps/mobile`) shows
 * a banner in the app. When to show and when to take away is the live
 * cache's rule, the same on both.
 */
export type ShownNotifications = {
	/** Shows a notice now. */
	show(notice: Notice): void | Promise<void>;
	/** Takes away every notification of the key: its Gate does not wait anymore. */
	close(key: string): void | Promise<void>;
	/** The notifications this screen shows now. */
	list(): Promise<readonly ListedNotification[]>;
};
