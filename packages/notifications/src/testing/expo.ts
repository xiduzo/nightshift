import type {
	ExpoClientOptions,
	ExpoPushErrorReceipt,
	ExpoPushMessage,
	ExpoPushReceipt,
	ExpoPushTicket,
} from "expo-server-sdk";

import type { ExpoClient } from "../channels";

type ExpoError = NonNullable<ExpoPushErrorReceipt["details"]>["error"];

export type FakeExpoClient = ExpoClient & {
	/** The options the channel made its client with. */
	options: Partial<ExpoClientOptions> | null;
	/** Give this as the channel's `createClient`. */
	create(options: Partial<ExpoClientOptions>): ExpoClient;
	/** The pushes sent, in order. */
	sent: ExpoPushMessage[];
	/** The receipt ids of each receipt request, in order. */
	receiptRequests: string[][];
	/** The receipt id of each push sent to the token, in order. */
	ticketsOf(token: string): string[];
	/** From now on, a send to the token answers with an error ticket. */
	refuse(token: string, error: ExpoError): void;
	/** The receipt Expo gives for the ticket from now on. */
	setReceipt(id: string, receipt: ExpoPushReceipt): void;
};

/**
 * Expo's push service, faked: it records each push, answers with a ticket,
 * and gives the receipts a test sets. Receipt ids go in chunks of
 * `chunkSize` (Expo: 300).
 */
export function fakeExpoClient(
	options: { chunkSize?: number } = {},
): FakeExpoClient {
	const chunkSize = options.chunkSize ?? 300;
	const sent: ExpoPushMessage[] = [];
	const receiptRequests: string[][] = [];
	const tickets = new Map<string, string[]>();
	const refused = new Map<string, ExpoError>();
	const receipts = new Map<string, ExpoPushReceipt>();
	let next = 0;
	const fake: FakeExpoClient = {
		options: null,
		create(given) {
			fake.options = given;
			return fake;
		},
		sent,
		receiptRequests,
		ticketsOf: (token) => tickets.get(token) ?? [],
		refuse: (token, error) => refused.set(token, error),
		setReceipt: (id, receipt) => receipts.set(id, receipt),

		async sendPushNotificationsAsync(messages) {
			return messages.map((message): ExpoPushTicket => {
				sent.push(message);
				const token = String(message.to);
				const error = refused.get(token);
				if (error) {
					return {
						status: "error",
						message: `Expo refused ${token}.`,
						details: { error, expoPushToken: token },
					};
				}
				next += 1;
				const id = `ticket-${next}`;
				tickets.set(token, [...(tickets.get(token) ?? []), id]);
				return { status: "ok", id };
			});
		},

		async getPushNotificationReceiptsAsync(ids) {
			receiptRequests.push([...ids]);
			const found: Record<string, ExpoPushReceipt> = {};
			for (const id of ids) {
				const receipt = receipts.get(id);
				if (receipt) found[id] = receipt;
			}
			return found;
		},

		chunkPushNotificationReceiptIds(ids) {
			const chunks: string[][] = [];
			for (let i = 0; i < ids.length; i += chunkSize) {
				chunks.push(ids.slice(i, i + chunkSize));
			}
			return chunks;
		},
	};
	return fake;
}
