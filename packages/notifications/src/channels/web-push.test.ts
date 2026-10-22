import { expect, test } from "bun:test";

import type { PushTarget } from "../targets";
import { fakeWebPushSender } from "../testing";
import type { NotificationMessage } from "./channel";
import { createWebPushChannel, topicOf } from "./web-push";

/**
 * The Web Push adapter, on a fake sender: what a browser gets (ids and one
 * sentence, no content), that a withdraw sends nothing, and what a push service's
 * answer means.
 */

const keys = {
	get: async () => ({ publicKey: "public", privateKey: "private" }),
};

const browser: PushTarget = {
	id: "target-1",
	personId: "ada",
	kind: "web",
	name: "Firefox on Mac",
	platform: "firefox",
	endpoint: "https://push.example/ada",
	keys: { p256dh: "p256dh-key", auth: "auth-secret" },
	sessionId: null,
	createdAt: 1,
	lastSeenAt: 1,
};

const gate: NotificationMessage = {
	key: "run-1:review",
	kind: "gate-opened",
	spaceId: "space-1",
	runId: "run-1",
	stepId: "review",
	title: "A Gate waits for you",
	alert: true,
	count: null,
	at: 1,
};

test("a push carries ids and one sentence, signed with the VAPID keys", async () => {
	const sender = fakeWebPushSender();
	const channel = createWebPushChannel({
		keys,
		subject: "mailto:host@example.com",
		sender: sender.send,
	});

	expect(await channel.send(browser, gate)).toBe("sent");

	const [request] = sender.requests;
	expect(request?.subscription).toEqual({
		endpoint: "https://push.example/ada",
		keys: { p256dh: "p256dh-key", auth: "auth-secret" },
	});
	expect(request?.vapid).toEqual({
		publicKey: "public",
		privateKey: "private",
		subject: "mailto:host@example.com",
	});
	expect(request?.urgency).toBe("high");
	expect(request?.topic).toBe(topicOf("run-1:review"));
	expect(request?.topic).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
	expect(sender.payloads()).toEqual([
		{
			type: "show",
			kind: "gate-opened",
			key: "run-1:review",
			spaceId: "space-1",
			runId: "run-1",
			stepId: "review",
			title: "A Gate waits for you",
			count: null,
		},
	]);
});

test("a withdraw sends no push: every push to a browser must show a notification", async () => {
	const sender = fakeWebPushSender();
	const channel = createWebPushChannel({
		keys,
		subject: "mailto:host@example.com",
		sender: sender.send,
	});

	await channel.send(browser, gate);
	await channel.withdraw(browser, "run-1:review");

	expect(sender.requests).toHaveLength(1);
	expect(sender.payloads()[0]).toMatchObject({ type: "show" });
});

test("a browser the push service no longer knows is gone", async () => {
	const sender = fakeWebPushSender();
	const channel = createWebPushChannel({
		keys,
		subject: "mailto:host@example.com",
		sender: sender.send,
	});

	sender.answer(browser.endpoint, 410);
	expect(await channel.send(browser, gate)).toBe("gone");
	sender.answer(browser.endpoint, 404);
	expect(await channel.send(browser, gate)).toBe("gone");
	// A withdraw to it closes nothing, and does not fail.
	await channel.withdraw(browser, "run-1:review");

	sender.answer(browser.endpoint, 500);
	await expect(channel.send(browser, gate)).rejects.toThrow(
		"The push service answered 500.",
	);
});

test("a browser without subscription keys is gone, and nothing is sent", async () => {
	const sender = fakeWebPushSender();
	const channel = createWebPushChannel({
		keys,
		subject: "mailto:host@example.com",
		sender: sender.send,
	});

	expect(await channel.send({ ...browser, keys: null }, gate)).toBe("gone");
	await channel.withdraw({ ...browser, keys: { p256dh: "x" } }, gate.key);
	expect(sender.requests).toEqual([]);
});

test("a run that ended is not urgent, and a run that failed is normal", async () => {
	const sender = fakeWebPushSender();
	const channel = createWebPushChannel({
		keys,
		subject: "mailto:host@example.com",
		sender: sender.send,
	});

	const ended = { ...gate, stepId: null, key: "run-1:end:9" };
	await channel.send(browser, { ...ended, kind: "run-finished" });
	await channel.send(browser, { ...ended, kind: "run-failed" });

	expect(sender.requests.map((r) => r.urgency)).toEqual(["low", "normal"]);
});
