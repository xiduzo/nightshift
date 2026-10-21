import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { OPEN_HOST, requestAccess } from "@nightshift/auth";
import { type AuthSandbox, createAuthSandbox } from "@nightshift/auth/testing";
import {
	createInAppChannel,
	createNotifications,
	type InAppChannel,
	type Notifications,
} from "@nightshift/notifications";
import { fakeRunEvents } from "@nightshift/notifications/testing";
import { call, ORPCError } from "@orpc/server";

import type { Context } from "../context";
import { appRouter } from "../router";

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
	});
});
afterEach(() => {
	notifications.stop();
	sandbox.cleanup();
});

async function contextFor(headers: Headers | null): Promise<Context> {
	const access = headers
		? await requestAccess(sandbox.auth, sandbox.db, headers, null, OPEN_HOST)
		: {
				session: null,
				spaceId: null,
				can: async () => false,
				hostAccess: { allowed: true } as const,
			};
	return {
		session: access.session,
		spaceId: access.spaceId,
		can: access.can,
		hostAccess: access.hostAccess,
		requireTwoFactor: false,
		fromThisComputer: false,
		db: sandbox.db,
		engine: { space: () => ({}) },
		notifications,
	} as unknown as Context;
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
});

describe("this computer's notification switches", () => {
	test("also change the owner's own notification settings", async () => {
		const ada = await sandbox.signUp("Ada");
		const context = await contextFor(ada.headers);
		const values = {
			notifyGateOpened: true,
			notifyRunFinished: false,
			notifyRunFailed: true,
		};
		const owned = {
			...context,
			daemon: { device: { id: "device", name: "mac", ownerId: ada.userId } },
			settings: { save: async () => ({ values, fields: {} }) },
		} as unknown as Context;

		await call(
			appRouter.settings.save,
			{ notifyRunFinished: false },
			{
				context: owned,
			},
		);

		expect((await notifications.settings.get(ada.userId)).events).toEqual({
			gateOpened: true,
			runFinished: false,
			runFailed: true,
		});
	});
});
