import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { requestAccess } from "@nightshift/auth";
import {
	type AuthSandbox,
	createAuthSandbox,
	OPEN_HOST,
} from "@nightshift/auth/testing";
import {
	createInAppChannel,
	createNotifications,
	type InAppChannel,
	type Notifications,
} from "@nightshift/notifications";
import {
	fakeRunEvents,
	fakeVapidKeys,
	fakeWebPushSender,
} from "@nightshift/notifications/testing";
import { call, ORPCError } from "@orpc/server";

import type { Context } from "../context";
import { appRouter } from "../router";
import { testContext } from "../testing";

/**
 * The notification procedures are each Person's own: a call needs a
 * session, and nobody reads or changes another Person's settings, screens
 * or stream.
 */

let sandbox: AuthSandbox;
let inApp: InAppChannel;
let notifications: Notifications;
beforeEach(async () => {
	sandbox = await createAuthSandbox();
	inApp = createInAppChannel();
	notifications = createNotifications({
		db: sandbox.db,
		events: fakeRunEvents().source,
		sendsFor: async () => true,
		inApp,
		webPush: {
			subject: "mailto:host@example.com",
			sender: fakeWebPushSender().send,
			generateKeys: fakeVapidKeys().generate,
		},
	});
});
afterEach(() => {
	notifications.stop();
	sandbox.cleanup();
});

/** A request from another computer, with these headers (none: signed out). */
async function contextFor(headers: Headers | null): Promise<Context> {
	return testContext({
		...(headers && {
			access: await requestAccess(
				sandbox.auth,
				sandbox.db,
				headers,
				null,
				OPEN_HOST,
			),
		}),
		db: sandbox.db,
		notifications,
	});
}

async function errorOf(promise: Promise<unknown>): Promise<string> {
	try {
		await promise;
	} catch (error) {
		if (error instanceof ORPCError) return error.code;
		throw error;
	}
	throw new Error("The call did not fail.");
}

const phone = {
	kind: "expo" as const,
	name: "Pixel 9",
	platform: "android",
	endpoint: "ExponentPushToken[ada]",
};

describe("notifications", () => {
	test("every procedure needs a session", async () => {
		const context = await contextFor(null);
		const procedures = appRouter.notifications;
		expect(
			await errorOf(call(procedures.settings.get, undefined, { context })),
		).toBe("UNAUTHORIZED");
		expect(
			await errorOf(
				call(procedures.settings.save, { holdMinutes: 5 }, { context }),
			),
		).toBe("UNAUTHORIZED");
		expect(
			await errorOf(call(procedures.targets.list, undefined, { context })),
		).toBe("UNAUTHORIZED");
		expect(
			await errorOf(call(procedures.targets.register, phone, { context })),
		).toBe("UNAUTHORIZED");
		expect(
			await errorOf(call(procedures.targets.remove, { id: "x" }, { context })),
		).toBe("UNAUTHORIZED");
		expect(await errorOf(call(procedures.watch, undefined, { context }))).toBe(
			"UNAUTHORIZED",
		);
		expect(
			await errorOf(call(procedures.webPush.key, undefined, { context })),
		).toBe("UNAUTHORIZED");
		expect(
			await errorOf(call(procedures.digest.latest, undefined, { context })),
		).toBe("UNAUTHORIZED");
		expect(
			await errorOf(call(procedures.digest.since, { since: 0 }, { context })),
		).toBe("UNAUTHORIZED");
	});

	test("a Person without a digest yet reads none", async () => {
		const ada = await contextFor((await sandbox.signUp("Ada")).headers);
		expect(
			await call(appRouter.notifications.digest.latest, undefined, {
				context: ada,
			}),
		).toBeNull();
		expect(
			await call(appRouter.notifications.digest.since, undefined, {
				context: ada,
			}),
		).toBeNull();
	});

	test("a Person gets the public key a browser subscribes with", async () => {
		const ada = await contextFor((await sandbox.signUp("Ada")).headers);
		const bob = await contextFor((await sandbox.signUp("Bob")).headers);
		const { webPush } = appRouter.notifications;

		const key = await call(webPush.key, undefined, { context: ada });
		expect(key).toEqual({ publicKey: "public-1" });
		expect(await call(webPush.key, undefined, { context: bob })).toEqual(key);
	});

	test("removing a phone signs that phone out", async () => {
		const adaPerson = await sandbox.signUp("Ada");
		const phoneHeaders = await sandbox.signIn("ada@example.com");
		const ada = await contextFor(adaPerson.headers);
		const onPhone = await contextFor(phoneHeaders);
		const { targets } = appRouter.notifications;

		// The phone registers itself with its own session.
		const added = await call(targets.register, phone, { context: onPhone });
		await call(targets.remove, { id: added.id }, { context: ada });

		expect(
			await sandbox.auth.api.getSession({ headers: phoneHeaders }),
		).toBeNull();
		expect(
			await sandbox.auth.api.getSession({ headers: adaPerson.headers }),
		).not.toBeNull();
		expect((await contextFor(phoneHeaders)).access.session).toBeNull();
	});

	test("settings are each Person's own", async () => {
		const ada = await contextFor((await sandbox.signUp("Ada")).headers);
		const bob = await contextFor((await sandbox.signUp("Bob")).headers);
		const { settings } = appRouter.notifications;

		const saved = await call(
			settings.save,
			{
				quietHours: { start: "22:00", end: "07:00" },
				events: { runFinished: false },
			},
			{ context: ada },
		);
		expect(saved).toMatchObject({
			quietHours: { start: "22:00", end: "07:00" },
			events: { gateOpened: true, runFinished: false, runFailed: true },
		});
		expect(await call(settings.get, undefined, { context: ada })).toEqual(
			saved,
		);
		expect(
			(await call(settings.get, undefined, { context: bob })).quietHours,
		).toBe(null);
	});

	test("a Person lists and removes only their own screens", async () => {
		const ada = await contextFor((await sandbox.signUp("Ada")).headers);
		const bob = await contextFor((await sandbox.signUp("Bob")).headers);
		const { targets } = appRouter.notifications;

		const added = await call(targets.register, phone, { context: ada });
		expect(added).toMatchObject({
			kind: "expo",
			name: "Pixel 9",
			platform: "android",
		});
		expect(added).not.toHaveProperty("endpoint");

		expect(await call(targets.list, undefined, { context: bob })).toEqual([]);
		expect(
			await errorOf(call(targets.remove, { id: added.id }, { context: bob })),
		).toBe("NOT_FOUND");
		expect(await call(targets.list, undefined, { context: ada })).toEqual([
			added,
		]);

		await call(targets.remove, { id: added.id }, { context: ada });
		expect(await call(targets.list, undefined, { context: ada })).toEqual([]);
	});

	test("refuses a screen it cannot read", async () => {
		const ada = await contextFor((await sandbox.signUp("Ada")).headers);
		expect(
			await errorOf(
				call(
					appRouter.notifications.targets.register,
					// A kind of screen Night Shift does not know.
					{ ...phone, kind: "pager" } as unknown as typeof phone,
					{ context: ada },
				),
			),
		).toBe("BAD_REQUEST");
	});

	test("refuses a browser outside a known push service, and this computer's desktop", async () => {
		const ada = await contextFor((await sandbox.signUp("Ada")).headers);
		const register = (screen: Record<string, unknown>) =>
			errorOf(
				call(
					appRouter.notifications.targets.register,
					screen as unknown as typeof phone,
					{ context: ada },
				),
			);

		// The Host would post each notification to this address.
		expect(
			await register({
				kind: "web",
				name: "Safari",
				endpoint: "https://10.0.0.5:8443/admin/reset",
				keys: { p256dh: "key", auth: "secret" },
			}),
		).toBe("BAD_REQUEST");
		// Only this computer's daemon registers its desktop, for its owner.
		expect(
			await register({ kind: "desktop", name: "x", endpoint: "device-1" }),
		).toBe("BAD_REQUEST");
		expect(await register({ ...phone, endpoint: "not-a-token" })).toBe(
			"BAD_REQUEST",
		);
		expect(
			await call(appRouter.notifications.targets.list, undefined, {
				context: ada,
			}),
		).toEqual([]);
	});

	test("a Person's stream carries only what is theirs", async () => {
		const adaPerson = await sandbox.signUp("Ada");
		const bobPerson = await sandbox.signUp("Bob");
		const ada = await contextFor(adaPerson.headers);
		const controller = new AbortController();
		const stream = (await call(appRouter.notifications.watch, undefined, {
			context: ada,
			signal: controller.signal,
		})) as AsyncIterator<unknown>;
		const first = stream.next();
		// The stream is open once its Person counts as having a screen open.
		while (!inApp.isActive(adaPerson.userId)) await Bun.sleep(5);

		const message = {
			kind: "gate-opened" as const,
			spaceId: "space-1",
			runId: "run-1",
			stepId: "step-1",
			title: "A Gate waits for you",
			alert: true,
			count: null,
			at: 1,
		};
		await inApp.send(
			{ kind: "in-app", personId: bobPerson.userId },
			{ ...message, key: "run-1:bob" },
		);
		await inApp.send(
			{ kind: "in-app", personId: adaPerson.userId },
			{ ...message, key: "run-1:step-1" },
		);

		expect((await first).value).toMatchObject({
			kind: "gate-opened",
			key: "run-1:step-1",
		});
		controller.abort();
		await stream.return?.();
	});

	test("the phone app's stream carries a run that changed, and counts as closed once it ends", async () => {
		const adaPerson = await sandbox.signUp("Ada");
		const ada = await contextFor(adaPerson.headers);
		const controller = new AbortController();
		const stream = (await call(
			appRouter.notifications.watch,
			{ phone: true },
			{ context: ada, signal: controller.signal },
		)) as AsyncIterator<unknown>;
		const first = stream.next();
		while (!inApp.isActive(adaPerson.userId)) await Bun.sleep(5);

		inApp.runChanged(
			{ kind: "in-app", personId: adaPerson.userId },
			{ spaceId: "space-1", runId: "run-1" },
		);

		expect((await first).value).toEqual({
			kind: "run-changed",
			spaceId: "space-1",
			runId: "run-1",
			at: expect.any(Number),
		});
		controller.abort();
		await stream.return?.();
		expect(inApp.isActive(adaPerson.userId)).toBe(false);
	});
});
