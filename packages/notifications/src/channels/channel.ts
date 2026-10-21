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
 * the rest.
 */

/** What one notification says. */
export type NotificationMessage = {
	/** The event key: `runId:stepId` for a Gate, `runId:end:<seq>` for a run that ended. */
	key: string;
	/** What happened. `gates-waiting`: quiet hours ended and Gates still wait. */
	kind: NoticeKind | "gates-waiting";
	/** Null for `gates-waiting`, which spans Spaces. */
	spaceId: string | null;
	runId: string | null;
	/** The Gate's step. Null for a run. */
	stepId: string | null;
	/** One short sentence for the person. */
	title: string;
	/**
	 * Show it as a notification. False: a screen only updates what it
	 * shows (another computer notifies for the Space, or the person turned
	 * this event off).
	 */
	alert: boolean;
	/** How many Gates wait (`gates-waiting`). Null otherwise. */
	count: number | null;
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

/** The key of a Gate. */
export function gateKey(runId: string, stepId: string): string {
	return `${runId}:${stepId}`;
}

/** The run and step of a Gate's key. Run ids hold no colon. */
export function parseGateKey(
	key: string,
): { runId: string; stepId: string } | null {
	const at = key.indexOf(":");
	if (at <= 0 || at === key.length - 1) return null;
	return { runId: key.slice(0, at), stepId: key.slice(at + 1) };
}

/** The key of one ending of a run: a run can end again after a resume. */
export function runEndKey(runId: string, seq: number): string {
	return `${runId}:end:${seq}`;
}

/** The sentence each notification says. */
export function titleOf(kind: NoticeKind): string {
	switch (kind) {
		case "gate-opened":
			return "A Gate waits for you";
		case "run-finished":
			return "A run finished";
		case "run-failed":
			return "A run failed";
	}
}

/** The sentence of the notification at the end of quiet hours. */
export function gatesWaitingTitle(count: number): string {
	return count === 1 ? "1 Gate waits for you" : `${count} Gates wait for you`;
}
