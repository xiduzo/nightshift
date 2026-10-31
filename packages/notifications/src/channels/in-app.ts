import { parseDeviceWaitKey, parseGateKey } from "../contract";
import type { NoticeKind } from "../deliveries";
import type {
	InAppTarget,
	NotificationChannel,
	NotificationMessage,
} from "./channel";

/**
 * The in-app stream: every open page and the open phone app of a Person
 * get each event at once, over one stream (`notifications.watch`). It
 * replaces polling. It also tells the notifier whether the Person has a
 * screen open now (`isActive`): the active screen goes first, and a push
 * to a phone waits.
 */

/** One item of the in-app stream. */
export type InAppItem =
	| {
			/** A digest has no item: a screen reads it when it shows the inbox. */
			kind: Exclude<NoticeKind, "digest">;
			key: string;
			spaceId: string;
			runId: string;
			stepId: string | null;
			title: string;
			/** The second line of a device wait. Absent: the screen words it. */
			body?: string;
			/** Show it as a notification. False: only update what the screen shows. */
			alert: boolean;
			at: number;
	  }
	/** A Gate closed: it was answered (on any screen), or its run stopped. */
	| {
			kind: "gate-closed";
			key: string;
			runId: string;
			stepId: string;
			at: number;
	  }
	/** A step no longer waits for its Device: it went on, or its run ended. */
	| {
			kind: "wait-ended";
			key: string;
			runId: string;
			stepId: string;
			at: number;
	  }
	/**
	 * A run changed what a list of runs shows: it started, slept or woke,
	 * moved, stopped or ended, or a step started or ended. Quiet: no key
	 * and no `alert`, so a screen only reads the run again. A screen that
	 * does not know the kind reads everything again, which is safe.
	 */
	| {
			kind: "run-changed";
			spaceId: string;
			runId: string;
			at: number;
	  }
	/**
	 * A project's schedules changed without a run: a person paused one
	 * tonight, or ended that pause. Quiet, like `run-changed`: a screen
	 * reads the schedules again. An older screen reads everything again.
	 */
	| {
			kind: "schedules-changed";
			spaceId: string;
			projectId: string;
			at: number;
	  };

/** A page counts as open this long after its stream ended: a page that reloads. */
const DEFAULT_RECENT_MS = 60_000;

/** Where a stream comes from. */
export type WatchOptions = {
	/** The screen is on this computer (the request came from this computer itself). */
	here?: boolean;
	/**
	 * The phone app. It ends its stream when it leaves the front, so it
	 * counts as closed at once: no minute for a reload.
	 */
	phone?: boolean;
};

export type InAppChannel = NotificationChannel<InAppTarget> & {
	/**
	 * The Person's stream: each item from now on, until `signal` aborts.
	 * While it is open, the Person has a screen open.
	 */
	watch(
		personId: string,
		signal: AbortSignal,
		options?: WatchOptions,
	): AsyncGenerator<InAppItem>;
	/** Tells the Person's open screens that a run changed. No push, no notification. */
	runChanged(
		target: InAppTarget,
		run: { spaceId: string; runId: string },
	): void;
	/** Tells the Person's open screens that a project's schedules changed. No push, no notification. */
	schedulesChanged(
		target: InAppTarget,
		change: { spaceId: string; projectId: string },
	): void;
	/**
	 * Whether the Person has a screen open, or closed a page a moment ago.
	 * A phone app that left the front does not count.
	 */
	isActive(personId: string): boolean;
	/** Whether the Person has a screen open on this computer, or had one a moment ago. */
	isActiveHere(personId: string): boolean;
};

export function createInAppChannel(
	options: { now?: () => number; recentMs?: number } = {},
): InAppChannel {
	const now = options.now ?? Date.now;
	const recentMs = options.recentMs ?? DEFAULT_RECENT_MS;
	const listeners = new Map<string, Set<(item: InAppItem) => void>>();
	/** When each Person's last page closed its stream. */
	const left = new Map<string, number>();
	/** The open streams from this computer, and when the last one ended, per Person. */
	const hereOpen = new Map<string, number>();
	const leftHere = new Map<string, number>();

	function publish(personId: string, item: InAppItem): void {
		for (const listener of [...(listeners.get(personId) ?? [])]) {
			try {
				listener(item);
			} catch {
				// A broken stream must not stop the others.
			}
		}
	}

	return {
		async send(target, message: NotificationMessage) {
			if (
				message.kind === "gates-waiting" ||
				message.kind === "digest" ||
				message.spaceId === null ||
				message.runId === null
			) {
				return "sent";
			}
			publish(target.personId, {
				kind: message.kind,
				key: message.key,
				spaceId: message.spaceId,
				runId: message.runId,
				stepId: message.stepId,
				title: message.title,
				...(message.body ? { body: message.body } : {}),
				alert: message.alert,
				at: message.at,
			});
			return "sent";
		},

		async withdraw(target, key) {
			const gate = parseGateKey(key);
			if (gate) {
				publish(target.personId, {
					kind: "gate-closed",
					key,
					...gate,
					at: now(),
				});
				return;
			}
			const wait = parseDeviceWaitKey(key);
			if (wait) {
				publish(target.personId, {
					kind: "wait-ended",
					key,
					...wait,
					at: now(),
				});
			}
		},

		runChanged(target, run) {
			publish(target.personId, { kind: "run-changed", ...run, at: now() });
		},

		schedulesChanged(target, change) {
			publish(target.personId, {
				kind: "schedules-changed",
				...change,
				at: now(),
			});
		},

		isActive(personId) {
			if ((listeners.get(personId)?.size ?? 0) > 0) return true;
			const at = left.get(personId);
			return at !== undefined && now() - at < recentMs;
		},

		isActiveHere(personId) {
			if ((hereOpen.get(personId) ?? 0) > 0) return true;
			const at = leftHere.get(personId);
			return at !== undefined && now() - at < recentMs;
		},

		async *watch(personId, signal, options = {}) {
			const here = options.here === true;
			if (here) hereOpen.set(personId, (hereOpen.get(personId) ?? 0) + 1);
			const queue: InAppItem[] = [];
			let wake: (() => void) | null = null;
			const notify = () => {
				const resolve = wake;
				wake = null;
				resolve?.();
			};
			const listener = (item: InAppItem) => {
				queue.push(item);
				notify();
			};
			let set = listeners.get(personId);
			if (!set) {
				set = new Set();
				listeners.set(personId, set);
			}
			set.add(listener);
			signal.addEventListener("abort", notify, { once: true });
			try {
				while (!signal.aborted) {
					const item = queue.shift();
					if (item) {
						yield item;
						continue;
					}
					await new Promise<void>((resolve) => {
						wake = resolve;
					});
				}
			} finally {
				signal.removeEventListener("abort", notify);
				const current = listeners.get(personId);
				current?.delete(listener);
				if (current?.size === 0) listeners.delete(personId);
				// The phone app left the front: that is no reload.
				if (options.phone !== true) left.set(personId, now());
				if (here) {
					const count = (hereOpen.get(personId) ?? 1) - 1;
					if (count > 0) hereOpen.set(personId, count);
					else hereOpen.delete(personId);
					leftHere.set(personId, now());
				}
			}
		},
	};
}
