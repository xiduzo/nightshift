import {
	Expo,
	type ExpoClientOptions,
	type ExpoPushMessage,
	type ExpoPushReceiptId,
	type ExpoPushTicket,
} from "expo-server-sdk";

import {
	PUSH_ANDROID_CHANNEL,
	PUSH_CATEGORY,
	type PushData,
	withdrawData,
} from "../contract";
import type { PushTarget } from "../targets";
import type {
	NotificationChannel,
	NotificationMessage,
	SendResult,
} from "./channel";

/**
 * The Expo Push channel: the Night Shift phone app gets its notifications
 * through Expo's push service (`expo-server-sdk`). A target's endpoint is
 * the phone's Expo push token. `docs/research/mobile.md` ("Phone push
 * contract") is what the phone app must follow.
 *
 * - A message carries ids and one short sentence, never content.
 * - The category says which buttons the phone shows: `gate-decide`
 *   (Approve and Reject, a Gate its author marked for the lock screen with
 *   exactly two options), `gate-open` (any other Gate: it opens the app),
 *   `run` (a run that finished or failed, or a step that waits for a
 *   Device: it opens the run).
 * - Android: a Gate goes to the `gates` channel (high importance), a
 *   run to `runs` (default importance). The phone app defines both.
 * - One notification per key: the key is the thread id, the collapse id
 *   and the Android tag, so a Gate pushed again replaces itself.
 * - Withdraw: Expo cannot delete a delivered notification from the
 *   server. Night Shift sends a data-only background push
 *   (`{ withdraw: key }`, content-available) and the phone app dismisses
 *   the notification of that key itself. iOS delivers background pushes on
 *   a best-effort basis, so the app also clears what is answered when it
 *   opens.
 * - Receipts: Expo answers a send with a ticket, and the delivery outcome
 *   comes later as a receipt. The channel checks receipts in chunks on a
 *   timer, off the send path. A receipt that says `DeviceNotRegistered`
 *   marks the token lost: the next send to it answers `gone`, and the
 *   notifier forgets the target.
 */

/** The parts of Expo's client the channel uses. Tests give a fake (`./testing`). */
export type ExpoClient = Pick<
	Expo,
	| "sendPushNotificationsAsync"
	| "getPushNotificationReceiptsAsync"
	| "chunkPushNotificationReceiptIds"
>;

export type ExpoChannelOptions = {
	/**
	 * The Expo access token of the project (EXPO_ACCESS_TOKEN). Optional:
	 * without one, Expo sends for projects that do not require one
	 * ("enhanced push security" off).
	 */
	accessToken?: string;
	/** Makes Expo's client. Default: the real one. Tests give a fake. */
	createClient?: (options: Partial<ExpoClientOptions>) => ExpoClient;
	now?: () => number;
	/** How long after a send its receipt is checked. Expo: about 15 minutes. */
	receiptDelayMs?: number;
	/** How long Expo keeps a receipt: a ticket older than this is dropped. Expo: about a day. */
	receiptMaxAgeMs?: number;
	/** Where errors go. Default: the console. */
	onError?: (message: string, error: unknown) => void;
};

export type ExpoChannel = NotificationChannel<PushTarget> & {
	/** Checks the receipts of the tickets old enough. The timer calls it; tests call it directly. */
	checkReceipts(): Promise<void>;
	/** How many tickets wait for their receipt. */
	pendingReceipts(): number;
	stop(): void;
};

const DEFAULT_RECEIPT_DELAY_MS = 15 * 60_000;
const DEFAULT_RECEIPT_MAX_AGE_MS = 24 * 60 * 60_000;

/** The push Expo sends for one message: ids, the short sentence, how to show it. */
export function expoMessage(
	token: string,
	message: NotificationMessage,
): ExpoPushMessage {
	const data: PushData = {
		kind: message.kind,
		key: message.key,
		spaceId: message.spaceId,
		runId: message.runId,
		stepId: message.stepId,
	};
	const once = {
		to: token,
		title: message.title,
		...(message.body ? { body: message.body } : {}),
		sound: "default",
		threadId: message.key,
		collapseId: message.key,
		tag: message.key,
	};
	if (
		message.kind === "run-finished" ||
		message.kind === "run-failed" ||
		message.kind === "device-wait"
	) {
		return {
			...once,
			data,
			categoryId: PUSH_CATEGORY.run,
			channelId: PUSH_ANDROID_CHANNEL.runs,
			priority: "normal",
			interruptionLevel: "active",
		};
	}
	if (message.kind === "digest") {
		// A summary, not a question: a tap opens the inbox, at default importance.
		return {
			...once,
			data,
			categoryId: PUSH_CATEGORY.open,
			channelId: PUSH_ANDROID_CHANNEL.runs,
			priority: "normal",
			interruptionLevel: "active",
		};
	}
	if (message.kind === "gates-waiting") data.count = message.count;
	const options = message.gate?.lockScreen ? message.gate.options : [];
	// The author marked this Gate to be answered from the lock screen. The
	// phone's buttons say Approve and Reject: Approve sends the first
	// option's id and Reject the second. The labels are not shown.
	if (options.length === 2) data.options = options;
	return {
		...once,
		data,
		categoryId:
			options.length === 2 ? PUSH_CATEGORY.decide : PUSH_CATEGORY.open,
		channelId: PUSH_ANDROID_CHANNEL.gates,
		priority: "high",
		interruptionLevel: "time-sensitive",
	};
}

/**
 * The background push that tells the phone app to dismiss the notification
 * of the key. No title, no sound: iOS wakes the app without showing
 * anything. Apple wants background pushes at normal priority.
 */
export function expoWithdrawMessage(
	token: string,
	key: string,
): ExpoPushMessage {
	return {
		to: token,
		data: withdrawData(key),
		contentAvailable: true,
		priority: "normal",
	};
}

export function createExpoChannel(
	options: ExpoChannelOptions = {},
): ExpoChannel {
	const now = options.now ?? Date.now;
	const delay = options.receiptDelayMs ?? DEFAULT_RECEIPT_DELAY_MS;
	const maxAge = options.receiptMaxAgeMs ?? DEFAULT_RECEIPT_MAX_AGE_MS;
	const onError =
		options.onError ??
		((message: string, error: unknown) =>
			console.error(`[notifications] ${message}`, error));
	// No token: Expo still sends for a project without enhanced push security.
	const client = (options.createClient ?? ((o) => new Expo(o)))(
		options.accessToken ? { accessToken: options.accessToken } : {},
	);
	/** Tickets that wait for their receipt, by receipt id. */
	const pending = new Map<ExpoPushReceiptId, { token: string; at: number }>();
	/** Tokens Expo no longer delivers to. The next send to one answers `gone`. */
	const lost = new Set<string>();
	let timer: ReturnType<typeof setTimeout> | null = null;
	let stopped = false;

	function schedule(): void {
		if (stopped || timer || pending.size === 0) return;
		timer = setTimeout(() => {
			timer = null;
			void checkReceipts()
				.catch((error) => onError("Expo push receipts were not read.", error))
				.finally(schedule);
		}, delay);
		// A wait for receipts never keeps the process alive.
		timer.unref?.();
	}

	/** Sends one push. False: Expo no longer knows the token. */
	async function deliver(message: ExpoPushMessage): Promise<boolean> {
		const token = message.to as string;
		const [ticket]: ExpoPushTicket[] = await client.sendPushNotificationsAsync([
			message,
		]);
		if (!ticket) throw new Error("Expo sent no ticket.");
		if (ticket.status === "ok") {
			pending.set(ticket.id, { token, at: now() });
			schedule();
			return true;
		}
		if (ticket.details?.error === "DeviceNotRegistered") return false;
		throw new Error(`Expo did not take the push: ${ticket.message}`);
	}

	async function checkReceipts(): Promise<void> {
		const at = now();
		const due = [...pending].filter(([, ticket]) => at - ticket.at >= delay);
		if (due.length === 0) return;
		const ids = due.map(([id]) => id);
		for (const chunk of client.chunkPushNotificationReceiptIds(ids)) {
			let receipts: Awaited<
				ReturnType<ExpoClient["getPushNotificationReceiptsAsync"]>
			>;
			try {
				receipts = await client.getPushNotificationReceiptsAsync(chunk);
			} catch (error) {
				onError("Expo push receipts were not read.", error);
				continue;
			}
			for (const id of chunk) {
				const ticket = pending.get(id);
				if (!ticket) continue;
				const receipt = receipts[id];
				if (!receipt) {
					// Not ready yet, or Expo no longer keeps it.
					if (at - ticket.at >= maxAge) pending.delete(id);
					continue;
				}
				pending.delete(id);
				if (receipt.status === "ok") continue;
				if (receipt.details?.error === "DeviceNotRegistered") {
					lost.add(ticket.token);
				} else {
					onError("An Expo push was not delivered.", receipt.message);
				}
			}
		}
	}

	/** Whether the token is lost: forgets it, so the token can register again. */
	function takeLost(token: string): boolean {
		return lost.delete(token);
	}

	return {
		async send(target, message): Promise<SendResult> {
			if (takeLost(target.endpoint) || !Expo.isExpoPushToken(target.endpoint)) {
				return "gone";
			}
			return (await deliver(expoMessage(target.endpoint, message)))
				? "sent"
				: "gone";
		},

		async withdraw(target, key) {
			if (lost.has(target.endpoint)) return;
			if (!Expo.isExpoPushToken(target.endpoint)) return;
			if (!(await deliver(expoWithdrawMessage(target.endpoint, key)))) {
				lost.add(target.endpoint);
			}
		},

		checkReceipts,
		pendingReceipts: () => pending.size,

		stop() {
			stopped = true;
			if (timer) clearTimeout(timer);
			timer = null;
		},
	};
}
