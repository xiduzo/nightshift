import { formatClock } from "@nightshift/time";

import type { GateOption } from "../contract";
import type { NoticeKind } from "../deliveries";
import type { PushKind, PushTarget } from "../targets";

/**
 * The port every channel implements: one way the notifier reaches a
 * screen. The in-app stream (`in-app.ts`) is here. Web Push, Expo Push and
 * the desktop notification are slots (`PushChannels`) that an adapter
 * fills, each with a fake for tests.
 *
 * A message carries no content: ids, what happened, and one short sentence
 * for the person ("A Gate waits for you"). A screen asks Night Shift for
 * the rest. A device wait names its flow and Device, and when the run
 * stops waiting: the phone and the browser cannot read that from a
 * notification.
 */

/**
 * What a push about a Gate may show beyond its ids. Only a Gate its author
 * marked (`lockScreen` on its Decision), to a person whose role allows an
 * answer, carries its options: they become buttons on the notification.
 */
export type GateFacts = {
	/** The person may answer this Gate from the lock screen. */
	lockScreen: boolean;
	/** The Gate's options, in the author's order. Empty when `lockScreen` is false. */
	options: GateOption[];
};

/** What one notification says. */
export type NotificationMessage = {
	/** The notification key (`contract/keys.ts`): a Gate, a run's end, the end of quiet hours, or a digest. */
	key: string;
	/** What happened. `gates-waiting`: quiet hours ended and Gates still wait. */
	kind: NoticeKind | "gates-waiting";
	/** Null for `gates-waiting` and `digest`, which span Spaces. */
	spaceId: string | null;
	runId: string | null;
	/** The Gate's step, or the step that waits for a Device. Null for a run. */
	stepId: string | null;
	/** One short sentence for the person. */
	title: string;
	/** A second line, for a device wait and a digest. Absent: the screen says what fits the kind. */
	body?: string;
	/**
	 * Show it as a notification. False: a screen only updates what it
	 * shows (another computer notifies for the Space, or the person turned
	 * this event off).
	 */
	alert: boolean;
	/** How many Gates wait (`gates-waiting`). Null otherwise. */
	count: number | null;
	/** A pushed `gate-opened`: whether it can be answered from the lock screen. Absent otherwise. */
	gate?: GateFacts;
	/**
	 * The open pages of the person showed this as a notification (an
	 * in-app item with `alert`). Absent or false: a page only updated, so
	 * the desktop of this computer must still show it.
	 */
	toldInApp?: boolean;
	at: number;
};

/** Whether a push reached its service. `gone`: the service no longer knows the target. */
export type SendResult = "sent" | "gone";

/** The open pages and apps of one Person: the in-app stream. */
export type InAppTarget = { kind: "in-app"; personId: string };

/** One way to reach a screen. */
export interface NotificationChannel<Target> {
	/** Sends the message to the target. */
	send(target: Target, message: NotificationMessage): Promise<SendResult>;
	/** Takes the notification of the key back from the target. */
	withdraw(target: Target, key: string): Promise<void>;
	/** Stops what the channel does in the background (Expo's receipt check). */
	stop?(): void;
}

/**
 * The push channels, one slot per kind of push target. An empty slot sends
 * nothing: a Host without an Expo token has no `expo`. Wave 2 fills them
 * with the Web Push (`web-push`), Expo Push (`expo-server-sdk`) and desktop
 * (an OS port) adapters.
 */
export type PushChannels = Partial<
	Record<PushKind, NotificationChannel<PushTarget>>
>;

/** The sentence each notification says. */
export function titleOf(kind: NoticeKind): string {
	switch (kind) {
		case "gate-opened":
			return "A Gate waits for you";
		case "run-finished":
			return "A run finished";
		case "run-failed":
			return "A run failed";
		case "device-wait":
			return "A step waits for a device";
		case "digest":
			return "Night Shift: last night";
	}
}

/** The sentence of the notification at the end of quiet hours. */
export function gatesWaitingTitle(count: number): string {
	return count === 1 ? "1 Gate waits for you" : `${count} Gates wait for you`;
}

/** What one notification says: its sentence, and a second line. */
export type NoticeWords = { title: string; body?: string };

/**
 * The words of a device wait: "<flow> waits for <device>", and what
 * happens next. A Device of an older version does not say its name: "a
 * device".
 */
export function deviceWaitWords(wait: {
	flow: string;
	device: string | null;
	stopAt: number | null;
	timeZone: string;
	now: number;
}): NoticeWords {
	const title = `${wait.flow} waits for ${wait.device ?? "a device"}`;
	const next = "The step starts when the device is back.";
	if (wait.stopAt === null || wait.stopAt <= wait.now) {
		return { title, body: next };
	}
	const at = formatClock(wait.stopAt, wait.now, wait.timeZone);
	return {
		title,
		body: `${next} If it is not back by ${at}, the run stops.`,
	};
}
