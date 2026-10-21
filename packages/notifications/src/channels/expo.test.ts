import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { PushTarget } from "../targets";
import { type FakeExpoClient, fakeExpoClient } from "../testing";
import type { NotificationMessage } from "./channel";
import { createExpoChannel, type ExpoChannel } from "./expo";

/**
 * The Expo Push channel against a fake Expo service: what each kind of
 * message looks like, the lock-screen category, the withdraw push, and
 * the receipts that make a target gone.
 */

const TOKEN = "ExponentPushToken[phone-1]";
const OTHER = "ExponentPushToken[phone-2]";
const MINUTE = 60_000;

let expo: FakeExpoClient;
let channel: ExpoChannel;
let clock: number;
let errors: string[];

function phone(endpoint = TOKEN): PushTarget {
	return {
		id: `target-${endpoint}`,
		personId: "ada",
		kind: "expo",
		name: "Ada's phone",
		platform: "ios",
		endpoint,
		keys: null,
		sessionId: null,
		createdAt: 0,
		lastSeenAt: null,
	};
}

function gate(extra: Partial<NotificationMessage> = {}): NotificationMessage {
	return {
		key: "run-1:step-1",
		kind: "gate-opened",
		spaceId: "space-1",
		runId: "run-1",
		stepId: "step-1",
		title: "A Gate waits for you",
		alert: true,
		count: null,
		at: 0,
		...extra,
	};
}

function runEnd(kind: "run-finished" | "run-failed"): NotificationMessage {
	return {
		key: "run-1:end:7",
		kind,
		spaceId: "space-1",
		runId: "run-1",
		stepId: null,
		title: kind === "run-finished" ? "A run finished" : "A run failed",
		alert: true,
		count: null,
		at: 0,
	};
}

const SHIP_OR_HOLD = {
	lockScreen: true,
	options: [
		{ id: "ship", label: "ship" },
		{ id: "hold", label: "hold" },
	],
};

beforeEach(() => {
	expo = fakeExpoClient({ chunkSize: 2 });
	clock = 0;
	errors = [];
	channel = createExpoChannel({
		accessToken: "expo-token",
		createClient: expo.create,
		now: () => clock,
		receiptDelayMs: 15 * MINUTE,
		onError: (message) => errors.push(message),
	});
});

afterEach(() => channel.stop());

describe("messages", () => {
	test("a Gate carries ids and the short sentence, at high priority", async () => {
		expect(await channel.send(phone(), gate())).toBe("sent");
		expect(expo.sent).toEqual([
			{
				to: TOKEN,
				title: "A Gate waits for you",
				sound: "default",
				threadId: "run-1:step-1",
				collapseId: "run-1:step-1",
				tag: "run-1:step-1",
				data: {
					kind: "gate-opened",
					key: "run-1:step-1",
					spaceId: "space-1",
					runId: "run-1",
					stepId: "step-1",
				},
				categoryId: "gate-open",
				channelId: "gates",
				priority: "high",
				interruptionLevel: "time-sensitive",
			},
		]);
	});

	test("a run that ended goes in the run category, at normal priority", async () => {
		await channel.send(phone(), runEnd("run-finished"));
		await channel.send(phone(), runEnd("run-failed"));
		for (const [i, push] of expo.sent.entries()) {
			expect(push).toMatchObject({
				categoryId: "run",
				channelId: "runs",
				priority: "normal",
				interruptionLevel: "active",
				collapseId: "run-1:end:7",
				threadId: "run-1:end:7",
				data: {
					kind: i === 0 ? "run-finished" : "run-failed",
					key: "run-1:end:7",
					runId: "run-1",
					stepId: null,
					spaceId: "space-1",
				},
			});
			expect(push.body).toBeUndefined();
		}
	});

	test("the end of quiet hours says how many Gates wait", async () => {
		await channel.send(phone(), {
			...gate(),
			key: "waiting:5",
			kind: "gates-waiting",
			spaceId: null,
			runId: null,
			stepId: null,
			title: "3 Gates wait for you",
			count: 3,
		});
		expect(expo.sent[0]).toMatchObject({
			title: "3 Gates wait for you",
			categoryId: "gate-open",
			channelId: "gates",
			priority: "high",
			data: { kind: "gates-waiting", key: "waiting:5", runId: null, count: 3 },
		});
	});
});

describe("lock-screen Gates", () => {
	test("a marked Gate with two options gets Approve and Reject", async () => {
		await channel.send(phone(), gate({ gate: SHIP_OR_HOLD }));
		expect(expo.sent[0]?.categoryId).toBe("gate-decide");
		expect(expo.sent[0]?.channelId).toBe("gates");
		expect(expo.sent[0]?.data).toEqual({
			kind: "gate-opened",
			key: "run-1:step-1",
			spaceId: "space-1",
			runId: "run-1",
			stepId: "step-1",
			options: SHIP_OR_HOLD.options,
		});
	});

	test("an unmarked Gate opens the app and carries no options", async () => {
		await channel.send(
			phone(),
			gate({ gate: { lockScreen: false, options: [] } }),
		);
		expect(expo.sent[0]?.categoryId).toBe("gate-open");
		expect(expo.sent[0]?.data).not.toHaveProperty("options");
	});

	test("a marked Gate with three options opens the app", async () => {
		await channel.send(
			phone(),
			gate({
				gate: {
					lockScreen: true,
					options: [
						{ id: "a", label: "a" },
						{ id: "b", label: "b" },
						{ id: "c", label: "c" },
					],
				},
			}),
		);
		expect(expo.sent[0]?.categoryId).toBe("gate-open");
		expect(expo.sent[0]?.data).not.toHaveProperty("options");
	});
});

describe("withdraw", () => {
	test("sends a background push with the key and nothing to show", async () => {
		await channel.withdraw(phone(), "run-1:step-1");
		expect(expo.sent).toEqual([
			{
				to: TOKEN,
				data: { withdraw: "run-1:step-1" },
				contentAvailable: true,
				priority: "normal",
			},
		]);
	});
});

describe("gone", () => {
	test("a ticket that says DeviceNotRegistered answers gone at once", async () => {
		expo.refuse(TOKEN, "DeviceNotRegistered");
		expect(await channel.send(phone(), gate())).toBe("gone");
		expect(channel.pendingReceipts()).toBe(0);
	});

	test("another refused ticket is an error, not gone", async () => {
		expo.refuse(TOKEN, "MessageRateExceeded");
		await expect(channel.send(phone(), gate())).rejects.toThrow(
			"Expo did not take the push",
		);
	});

	test("a token that is not an Expo push token is gone", async () => {
		expect(await channel.send(phone("not-a-token"), gate())).toBe("gone");
		expect(expo.sent).toEqual([]);
	});

	test("a receipt that says DeviceNotRegistered makes the next send gone", async () => {
		await channel.send(phone(), gate());
		await channel.send(phone(OTHER), gate());
		const [lostTicket] = expo.ticketsOf(TOKEN);
		expo.setReceipt(lostTicket as string, {
			status: "error",
			message: "The phone is no longer registered.",
			details: { error: "DeviceNotRegistered" },
		});
		expo.setReceipt(expo.ticketsOf(OTHER)[0] as string, { status: "ok" });

		clock += 15 * MINUTE;
		await channel.checkReceipts();

		expect(channel.pendingReceipts()).toBe(0);
		expect(await channel.send(phone(), gate())).toBe("gone");
		expect(await channel.send(phone(OTHER), gate())).toBe("sent");
		expect(expo.sent.filter((push) => push.to === TOKEN)).toHaveLength(1);
		expect(errors).toEqual([]);
	});

	test("receipts are read in chunks, only once their tickets are old enough", async () => {
		for (const n of [1, 2, 3]) {
			await channel.send(phone(`ExponentPushToken[p${n}]`), gate());
		}
		await channel.checkReceipts();
		expect(expo.receiptRequests).toEqual([]);

		clock += 15 * MINUTE;
		await channel.send(phone("ExponentPushToken[late]"), gate());
		await channel.checkReceipts();
		expect(expo.receiptRequests).toEqual([
			["ticket-1", "ticket-2"],
			["ticket-3"],
		]);
		// No receipt yet: the tickets wait for the next check.
		expect(channel.pendingReceipts()).toBe(4);
	});

	test("a ticket without a receipt after a day is dropped", async () => {
		await channel.send(phone(), gate());
		clock += 25 * 60 * MINUTE;
		await channel.checkReceipts();
		expect(channel.pendingReceipts()).toBe(0);
	});

	test("another receipt error is reported, and the target stays", async () => {
		await channel.send(phone(), gate());
		expo.setReceipt(expo.ticketsOf(TOKEN)[0] as string, {
			status: "error",
			message: "Apple said no.",
			details: { error: "ProviderError" },
		});
		clock += 15 * MINUTE;
		await channel.checkReceipts();
		expect(errors).toEqual(["An Expo push was not delivered."]);
		expect(await channel.send(phone(), gate())).toBe("sent");
	});

	test("the timer checks the receipts on its own", async () => {
		const timed = createExpoChannel({
			createClient: expo.create,
			receiptDelayMs: 5,
		});
		await timed.send(phone(), gate());
		expo.setReceipt(expo.ticketsOf(TOKEN)[0] as string, {
			status: "error",
			message: "The phone is no longer registered.",
			details: { error: "DeviceNotRegistered" },
		});
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(timed.pendingReceipts()).toBe(0);
		expect(await timed.send(phone(), gate())).toBe("gone");
		timed.stop();
	});
});

describe("access token", () => {
	test("the client gets the token when the Host has one", () => {
		expect(expo.options).toEqual({ accessToken: "expo-token" });
	});

	test("without a token the client is made without one, and still sends", async () => {
		const open = fakeExpoClient();
		const tokenless = createExpoChannel({ createClient: open.create });
		expect(open.options).toEqual({});
		expect(await tokenless.send(phone(), gate())).toBe("sent");
		expect(open.sent).toHaveLength(1);
		tokenless.stop();
	});

	test("without a fake, the channel makes Expo's own client", () => {
		const real = createExpoChannel();
		expect(typeof real.send).toBe("function");
		real.stop();
	});
});
