import { afterEach, beforeEach, expect, test } from "bun:test";
import { personalSpaceId } from "@nightshift/auth";
import { type AuthSandbox, createAuthSandbox } from "@nightshift/auth/testing";

import { createInAppChannel } from "./channels";
import {
	type FakeRunEvents,
	type FakeWebPushSender,
	fakeRunEvents,
	fakeVapidKeys,
	fakeWebPushSender,
} from "./testing";
import { createNotifications, type Notifications } from "./wire";

/**
 * The notifications wired on a real Better Auth: Web Push with the keys
 * this daemon keeps, and a removed phone that is signed out.
 */

let sandbox: AuthSandbox;
let events: FakeRunEvents;
let sender: FakeWebPushSender;
let notifications: Notifications;

beforeEach(async () => {
	sandbox = await createAuthSandbox();
	events = fakeRunEvents();
	sender = fakeWebPushSender();
	notifications = createNotifications({
		db: sandbox.db,
		events: events.source,
		sendsFor: async () => true,
		inApp: createInAppChannel(),
		webPush: {
			subject: "mailto:host@example.com",
			sender: sender.send,
			generateKeys: fakeVapidKeys().generate,
		},
		tickMs: 60_000,
	});
});
afterEach(() => {
	notifications.stop();
	sandbox.cleanup();
});

const browser = {
	kind: "web" as const,
	name: "Firefox on Mac",
	platform: "firefox",
	endpoint: "https://push.example/ada",
	keys: { p256dh: "p256dh-key", auth: "auth-secret" },
};

const phone = {
	kind: "expo" as const,
	name: "Pixel 9",
	platform: "android",
	endpoint: "ExponentPushToken[ada]",
};

async function sessionIdOf(headers: Headers): Promise<string | null> {
	return (await sandbox.auth.api.getSession({ headers }))?.session.id ?? null;
}

test("a browser subscribes with the public key this daemon keeps", async () => {
	expect(await notifications.webPush.publicKey()).toBe("public-1");
	expect(await notifications.webPush.publicKey()).toBe("public-1");

	const withoutWebPush = createNotifications({
		db: sandbox.db,
		events: events.source,
		sendsFor: async () => true,
		inApp: createInAppChannel(),
	});
	expect(await withoutWebPush.webPush.publicKey()).toBeNull();
});

test("a new Gate goes to the Person's browser, and its answer withdraws it", async () => {
	const ada = await sandbox.signUp("Ada");
	const spaceId = (await personalSpaceId(sandbox.db, ada.userId)) ?? "";
	expect(spaceId).not.toBe("");
	await notifications.targets.register(ada.userId, browser);
	await notifications.start();

	events.setOpen(spaceId, [{ runId: "run-1", stepId: "review" }]);
	events.land([
		{
			spaceId,
			runId: "run-1",
			stepId: "review",
			type: "GateOpened",
			seq: 1,
			payload: {},
		},
	]);
	await waitFor(() => sender.requests.length === 1);

	events.setOpen(spaceId, []);
	events.land([
		{
			spaceId,
			runId: "run-1",
			stepId: "review",
			type: "GateResolved",
			seq: 2,
			payload: {},
		},
	]);
	await waitFor(() => sender.requests.length === 2);

	expect(sender.payloads()).toEqual([
		{
			type: "show",
			kind: "gate-opened",
			key: "run-1:review",
			spaceId,
			runId: "run-1",
			stepId: "review",
			title: "A Gate waits for you",
			count: null,
		},
		{ type: "withdraw", key: "run-1:review" },
	]);
});

test("a browser the push service lost is forgotten", async () => {
	const ada = await sandbox.signUp("Ada");
	const spaceId = (await personalSpaceId(sandbox.db, ada.userId)) ?? "";
	await notifications.targets.register(ada.userId, browser);
	sender.answer(browser.endpoint, 410);
	await notifications.start();

	events.setOpen(spaceId, [{ runId: "run-1", stepId: "review" }]);
	events.land([
		{
			spaceId,
			runId: "run-1",
			stepId: "review",
			type: "GateOpened",
			seq: 1,
			payload: {},
		},
	]);
	await waitFor(() => sender.requests.length === 1);
	await waitFor(
		async () => (await notifications.targets.list(ada.userId)).length === 0,
	);
});

test("removing a phone signs it out; removing a browser does not", async () => {
	const ada = await sandbox.signUp("Ada");
	const phoneHeaders = await sandbox.signIn("ada@example.com");
	const phoneSession = await sessionIdOf(phoneHeaders);
	const browserSession = await sessionIdOf(ada.headers);

	const addedPhone = await notifications.targets.register(
		ada.userId,
		phone,
		phoneSession,
	);
	const addedBrowser = await notifications.targets.register(
		ada.userId,
		browser,
		browserSession,
	);

	await notifications.targets.remove(ada.userId, addedBrowser.id);
	expect(await sessionIdOf(ada.headers)).toBe(browserSession);

	await notifications.targets.remove(ada.userId, addedPhone.id);
	expect(await sessionIdOf(phoneHeaders)).toBeNull();
	expect(await sessionIdOf(ada.headers)).toBe(browserSession);
	expect(await notifications.targets.list(ada.userId)).toEqual([]);
});

test("nobody removes or signs out another Person's phone", async () => {
	const ada = await sandbox.signUp("Ada");
	const bob = await sandbox.signUp("Bob");
	const adaSession = await sessionIdOf(ada.headers);
	const added = await notifications.targets.register(
		ada.userId,
		phone,
		adaSession,
	);

	expect(await notifications.targets.remove(bob.userId, added.id)).toBeNull();
	expect(await sessionIdOf(ada.headers)).toBe(adaSession);
});

async function waitFor(
	condition: () => boolean | Promise<boolean>,
): Promise<void> {
	const until = Date.now() + 2_000;
	while (!(await condition())) {
		if (Date.now() > until) throw new Error("It did not happen in time.");
		await Bun.sleep(5);
	}
}
