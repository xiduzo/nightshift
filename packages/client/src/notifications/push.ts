/**
 * The push contract, as the screens read it: the notification keys, what a
 * push carries, and where a tap goes. The rules live in one place,
 * `@nightshift/notifications/contract`, which the Host sends by. This file
 * passes them on, and adds the rule a screen needs to clear what it shows.
 */

import { isGateKey } from "@nightshift/notifications/contract";

export {
	gateKey,
	isGateKey,
	PUSH_ACTION,
	PUSH_ANDROID_CHANNEL,
	PUSH_CATEGORY,
	PUSH_MESSAGE_KINDS,
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

/**
 * The shown Gate notifications whose Gate no longer waits: someone answered
 * it, or its run ended. Only Gate keys count, not in `openKeys`, and only
 * notifications shown more than 30 s before the read (`readAt`).
 */
export function staleGates<T extends ShownNotification>(
	shown: readonly T[],
	openKeys: ReadonlySet<string>,
	readAt: number,
): T[] {
	return shown.filter(
		(item) =>
			item.at < readAt - READ_MARGIN_MS &&
			item.key !== null &&
			isGateKey(item.key) &&
			!openKeys.has(item.key),
	);
}
