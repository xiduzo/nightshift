import { createHash } from "node:crypto";
import { sendNotification, WebPushError } from "web-push";

import type { PushTarget } from "../targets";
import type {
	NotificationChannel,
	NotificationMessage,
	SendResult,
} from "./channel";
import type { VapidKeyStore, VapidKeys } from "./vapid-keys";

/**
 * Web Push: a browser gets the notification while no Night Shift page is
 * open. The `web-push` library encrypts each message for the browser's
 * subscription and signs it with this daemon's VAPID keys. The service
 * worker of the web app (`apps/web/public/sw.js`) shows it.
 *
 * The message carries no content, only ids and one short sentence. It
 * goes on one Web Push topic per key, so a second message of a key
 * replaces one the push service still holds.
 *
 * A withdraw sends nothing. The browser subscribes with
 * `userVisibleOnly`: every push must show a notification, and a push that
 * shows none costs the site (Safari ends the subscription after a few,
 * Chrome shows a notice of its own). An open Night Shift page closes the
 * notifications of the Gates that no longer wait instead (`apps/web`,
 * `features/notifications`).
 */

/** What the service worker gets. */
export type WebPushPayload = {
	type: "show";
	kind: NotificationMessage["kind"];
	key: string;
	spaceId: string | null;
	runId: string | null;
	stepId: string | null;
	title: string;
	/** How many Gates wait (`gates-waiting`). Null otherwise. */
	count: number | null;
};

/** A browser's push subscription, as `PushSubscription.toJSON()` gives it. */
export type WebPushSubscription = {
	endpoint: string;
	keys: { p256dh: string; auth: string };
};

/** One message to one browser. */
export type WebPushRequest = {
	subscription: WebPushSubscription;
	/** The JSON of a `WebPushPayload`. */
	payload: string;
	vapid: VapidKeys & { subject: string };
	/** How long the push service keeps it for a browser that is offline. */
	ttlSeconds: number;
	urgency: "very-low" | "low" | "normal" | "high";
	/** A later message of the same topic replaces one the service still holds. */
	topic: string;
};

/**
 * The port to the push services: sends one message and returns the HTTP
 * status the push service answered. It throws only when the service could
 * not be reached. Tests use a fake (`fakeWebPushSender`).
 */
export type WebPushSender = (
	request: WebPushRequest,
) => Promise<{ statusCode: number }>;

/** The sender on the `web-push` library. */
export function webPushSender(): WebPushSender {
	return async (request) => {
		try {
			const result = await sendNotification(
				request.subscription,
				request.payload,
				{
					vapidDetails: request.vapid,
					TTL: request.ttlSeconds,
					urgency: request.urgency,
					topic: request.topic,
				},
			);
			return { statusCode: result.statusCode };
		} catch (error) {
			if (error instanceof WebPushError) {
				return { statusCode: error.statusCode };
			}
			throw error;
		}
	};
}

export type WebPushChannelOptions = {
	keys: VapidKeyStore;
	/**
	 * Who sends: an `https:` URL or a `mailto:` address. A push service
	 * may contact it about this daemon's messages.
	 */
	subject: string;
	sender?: WebPushSender;
};

/** A day: a Gate can wait that long for a browser that is offline. */
const TTL_SECONDS = 24 * 60 * 60;

/** The Web Push topic of a key: at most 32 URL-safe base64 characters. */
export function topicOf(key: string): string {
	return createHash("sha256").update(key).digest("base64url").slice(0, 32);
}

function urgencyOf(
	kind: NotificationMessage["kind"],
): WebPushRequest["urgency"] {
	if (kind === "gate-opened" || kind === "gates-waiting") return "high";
	if (kind === "run-failed") return "normal";
	return "low";
}

/** The subscription of a browser target. Null when it has no keys. */
function subscriptionOf(target: PushTarget): WebPushSubscription | null {
	const p256dh = target.keys?.p256dh;
	const auth = target.keys?.auth;
	if (!p256dh || !auth) return null;
	return { endpoint: target.endpoint, keys: { p256dh, auth } };
}

/** The service no longer knows the subscription: the browser unsubscribed. */
const isGone = (statusCode: number) => statusCode === 404 || statusCode === 410;

export function createWebPushChannel(
	options: WebPushChannelOptions,
): NotificationChannel<PushTarget> {
	const sender = options.sender ?? webPushSender();

	async function deliver(
		subscription: WebPushSubscription,
		payload: WebPushPayload,
		urgency: WebPushRequest["urgency"],
	): Promise<SendResult> {
		const keys = await options.keys.get();
		const { statusCode } = await sender({
			subscription,
			payload: JSON.stringify(payload),
			vapid: { ...keys, subject: options.subject },
			ttlSeconds: TTL_SECONDS,
			urgency,
			topic: topicOf(payload.key),
		});
		if (isGone(statusCode)) return "gone";
		if (statusCode < 200 || statusCode >= 300) {
			throw new Error(`The push service answered ${statusCode}.`);
		}
		return "sent";
	}

	return {
		async send(target, message) {
			const subscription = subscriptionOf(target);
			// Without keys nothing reaches the browser: it registers again.
			if (!subscription) return "gone";
			return deliver(
				subscription,
				{
					type: "show",
					kind: message.kind,
					key: message.key,
					spaceId: message.spaceId,
					runId: message.runId,
					stepId: message.stepId,
					title: message.title,
					count: message.count,
				},
				urgencyOf(message.kind),
			);
		},
		// No push: a push that shows nothing breaks `userVisibleOnly` (see above).
		async withdraw() {},
	};
}
