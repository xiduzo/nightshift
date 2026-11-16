/**
 * The push contract, as the screens read it: the notification keys, what a
 * push carries, and where a tap goes. The rules live in one place,
 * `@nightshift/notifications/contract`, which the Host sends by. This file
 * passes them on, and adds the rule a screen needs to clear what it shows.
 */

import {
	gateKey,
	isGateKey,
	isWaitingKey,
} from "@nightshift/notifications/contract";

export {
	gateKey,
	PUSH_ACTION,
	PUSH_ANDROID_CHANNEL,
	PUSH_CATEGORY,
	type PushData,
	type PushMessageKind,
	type PushRoute,
	pushDataOf,
	routeOf,
	webPathOf,
	withdrawKeyOf,
} from "@nightshift/notifications/contract";

/** A notification a screen shows: the Host's key (null: not one of the Host's), and when it showed, in ms. */
export type ShownNotification = { key: string | null; at: number };

/**
 * How much older than the read a notification must be to count as closed.
 * A read that started before a push came does not know its Gate yet.
 */
const READ_MARGIN_MS = 30_000;

/** A Gate a read of the open Gates found: its run and step, and whether an answer to it is on its way. */
export type ReadGate = {
	runId: string;
	stepId: string;
	answerPending?: boolean;
};

/**
 * The shown Gate notifications whose Gate no longer waits: someone answered
 * it, an answer to it is on its way, or its run ended. "N Gates wait for
 * you" no longer counts when the read (`open`) holds no Gate that waits.
 * Only notifications shown more than 30 s before the read (`readAt`) count.
 */
export function staleGates<T extends ShownNotification>(
	shown: readonly T[],
	open: readonly ReadGate[],
	readAt: number,
): T[] {
	const waiting = new Set(
		open.filter((gate) => !gate.answerPending).map(gateKey),
	);
	return shown.filter(
		(item) =>
			item.at < readAt - READ_MARGIN_MS &&
			item.key !== null &&
			((isGateKey(item.key) && !waiting.has(item.key)) ||
				(isWaitingKey(item.key) && waiting.size === 0)),
	);
}
