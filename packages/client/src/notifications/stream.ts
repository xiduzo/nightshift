import {
	type RunStreamConnection,
	retryDelay,
	type Wait,
	waitFor,
} from "../runs";
import type { NotificationItem } from "./types";

/**
 * The one procedure the stream needs: `notifications.watch`. The client of
 * `createApiClient` has it, and a test passes a fake.
 */
export type NotificationWatchClient = {
	notifications: {
		watch: (
			input: { phone?: boolean } | undefined,
			options: { signal: AbortSignal },
		) => Promise<AsyncIterable<NotificationItem>>;
	};
};

export type FollowNotificationsOptions = {
	client: NotificationWatchClient;
	/**
	 * The phone app follows. It stops the stream when it leaves the front,
	 * so Night Shift counts it as closed at once and pushes to it.
	 */
	phone?: boolean;
	/** Stops the stream. `followNotifications` resolves soon after. */
	signal: AbortSignal;
	/** Each item, in order. */
	onItem: (item: NotificationItem) => void;
	/**
	 * The state of the stream. Items that happen while it reconnects are
	 * lost: on each `live` after the first, read again what the screen shows.
	 */
	onConnection?: (connection: RunStreamConnection) => void;
	/** How to wait before a retry. Tests pass one that does not wait. */
	wait?: Wait;
};

/**
 * Follows `notifications.watch` until `signal` aborts: what happens in
 * every Space the person is in, as it happens. It replaces polling. When
 * the stream drops or ends, it connects again with backoff (`retryDelay`),
 * which starts again at one second once the stream is live.
 */
export async function followNotifications({
	client,
	phone = false,
	signal,
	onItem,
	onConnection,
	wait = waitFor,
}: FollowNotificationsOptions): Promise<void> {
	let attempt = 0;
	onConnection?.("connecting");
	while (!signal.aborted) {
		try {
			const stream = await client.notifications.watch(
				phone ? { phone: true } : undefined,
				{ signal },
			);
			attempt = 0;
			onConnection?.("live");
			for await (const item of stream) onItem(item);
		} catch {
			// Dropped connection or server error: fall through to the retry.
		}
		if (signal.aborted) return;
		onConnection?.("reconnecting");
		const delay = retryDelay(attempt);
		attempt += 1;
		await wait(delay, signal);
	}
}
