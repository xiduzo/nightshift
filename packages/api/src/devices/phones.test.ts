import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { requestAccess } from "@nightshift/auth";
import {
	type AuthSandbox,
	createAuthSandbox,
	OPEN_HOST,
} from "@nightshift/auth/testing";
import type { PhoneView } from "@nightshift/devices";
import {
	createInAppChannel,
	createNotifications,
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
 * A Person's phones belong to a Host: the phone app signs in to a Host
 * only. The Devices page of a Space shows the phones on its Host: this
 * computer's own, or a joined Host's, asked over the link of this
 * computer's owner.
 */

let sandbox: AuthSandbox;
let notifications: Notifications;
beforeEach(async () => {
	sandbox = await createAuthSandbox();
	notifications = createNotifications({
		db: sandbox.db,
		events: fakeRunEvents().source,
		sendsFor: async () => true,
		inApp: createInAppChannel(),
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

const hostPhone: PhoneView = {
	id: "on-host",
	name: "iPhone on the Host",
	platform: "ios",
	createdAt: 1,
	lastSeenAt: null,
};

/** The Host each Space is kept by (absent: this computer), and the calls to it. */
function fakeDevices(hosts: Record<string, string>) {
	const removed: [string, string][] = [];
	return {
		removed,
		devices: {
			hostOf: async (spaceId: string) => hosts[spaceId] ?? null,
			phonesAt: async () => [hostPhone],
			removePhoneAt: async (hostId: string, id: string) => {
				removed.push([hostId, id]);
			},
		},
	};
}

async function contextFor(
	headers: Headers,
	options: {
		ownerId: string;
		devices: ReturnType<typeof fakeDevices>["devices"];
		spaceId?: string;
	},
): Promise<Context> {
	const access = await requestAccess(
		sandbox.auth,
		sandbox.db,
		headers,
		null,
		OPEN_HOST,
	);
	return testContext({
		access: { ...access, spaceId: options.spaceId ?? access.spaceId },
		db: sandbox.db,
		notifications,
		devices: options.devices,
		daemon: { device: { id: "d", name: "test", ownerId: options.ownerId } },
	});
}

function keyContext(personId: string): Context {
	return testContext({
		deviceKey: {
			keyId: "k",
			deviceId: "d",
			personId,
			permissions: { sync: ["read", "write"] },
		},
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

/** A phone and a browser of the Person, as they register for notifications. */
async function registerScreens(personId: string, name: string) {
	const phone = await notifications.targets.register(personId, {
		kind: "expo",
		name,
		platform: "ios",
		endpoint: `ExponentPushToken[${name}]`,
	});
	await notifications.targets.register(personId, {
		kind: "web",
		name: "Firefox",
		platform: "macos",
		endpoint: `https://updates.push.services.mozilla.com/wpush/v2/${name}`,
	});
	return phone;
}

describe("phones in a Space this computer keeps", () => {
	test("are the Person's own phones here, without their browsers", async () => {
		const ada = await sandbox.signUp("Ada");
		const bob = await sandbox.signUp("Bob");
		const adaPhone = await registerScreens(ada.userId, "ada");
		await registerScreens(bob.userId, "bob");
		const { devices } = fakeDevices({});
		const context = await contextFor(ada.headers, {
			ownerId: ada.userId,
			devices,
		});

		const phones = await call(appRouter.devices.phones, undefined, {
			context,
		});
		expect(phones.map((p) => p.id)).toEqual([adaPhone.id]);
		expect(phones[0]?.name).toBe("ada");
	});

	test("a Person signs out only their own phone", async () => {
		const ada = await sandbox.signUp("Ada");
		const bob = await sandbox.signUp("Bob");
		const adaPhone = await registerScreens(ada.userId, "ada");
		const bobPhone = await registerScreens(bob.userId, "bob");
		const { devices } = fakeDevices({});
		const context = await contextFor(ada.headers, {
			ownerId: ada.userId,
			devices,
		});

		expect(
			await errorOf(
				call(appRouter.devices.removePhone, { id: bobPhone.id }, { context }),
			),
		).toBe("NOT_FOUND");
		await call(appRouter.devices.removePhone, { id: adaPhone.id }, { context });
		expect(
			await call(appRouter.devices.phones, undefined, { context }),
		).toEqual([]);
		expect(
			(await notifications.targets.list(bob.userId)).map((t) => t.id),
		).toContain(bobPhone.id);
	});
});

describe("phones in a Space a Host keeps", () => {
	test("come from the Host, for this computer's owner only", async () => {
		const ada = await sandbox.signUp("Ada");
		const bob = await sandbox.signUp("Bob");
		await registerScreens(ada.userId, "ada");
		const { devices } = fakeDevices({ "space-on-host": "host-1" });
		const owner = await contextFor(ada.headers, {
			ownerId: ada.userId,
			devices,
			spaceId: "space-on-host",
		});
		const other = await contextFor(bob.headers, {
			ownerId: ada.userId,
			devices,
			spaceId: "space-on-host",
		});

		expect(
			await call(appRouter.devices.phones, undefined, { context: owner }),
		).toEqual([hostPhone]);
		expect(
			await call(appRouter.devices.phones, undefined, { context: other }),
		).toEqual([]);
	});

	test("only this computer's owner signs one out, on the Host", async () => {
		const ada = await sandbox.signUp("Ada");
		const bob = await sandbox.signUp("Bob");
		const { devices, removed } = fakeDevices({ "space-on-host": "host-1" });
		const owner = await contextFor(ada.headers, {
			ownerId: ada.userId,
			devices,
			spaceId: "space-on-host",
		});
		const other = await contextFor(bob.headers, {
			ownerId: ada.userId,
			devices,
			spaceId: "space-on-host",
		});

		expect(
			await errorOf(
				call(
					appRouter.devices.removePhone,
					{ id: "on-host" },
					{ context: other },
				),
			),
		).toBe("FORBIDDEN");
		await call(
			appRouter.devices.removePhone,
			{ id: "on-host" },
			{ context: owner },
		);
		expect(removed).toEqual([["host-1", "on-host"]]);
	});
});

describe("a Host's phones over a Device's link", () => {
	test("are the phones of the key's Person", async () => {
		const ada = await sandbox.signUp("Ada");
		const bob = await sandbox.signUp("Bob");
		const adaPhone = await registerScreens(ada.userId, "ada");
		const bobPhone = await registerScreens(bob.userId, "bob");
		const context = keyContext(ada.userId);

		const phones = await call(appRouter.link.phones, undefined, { context });
		expect(phones.map((p) => p.id)).toEqual([adaPhone.id]);
		expect(
			await errorOf(
				call(appRouter.link.removePhone, { id: bobPhone.id }, { context }),
			),
		).toBe("NOT_FOUND");
		await call(appRouter.link.removePhone, { id: adaPhone.id }, { context });
		expect(await call(appRouter.link.phones, undefined, { context })).toEqual(
			[],
		);
	});

	test("need a Device key", async () => {
		const context = testContext();
		expect(
			await errorOf(call(appRouter.link.phones, undefined, { context })),
		).toBe("UNAUTHORIZED");
	});
});
