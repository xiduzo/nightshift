import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DeviceKeyAccess } from "@nightshift/auth";
import { type AuthSandbox, createAuthSandbox } from "@nightshift/auth/testing";
import { user } from "@nightshift/db/schema";
import type { SettingsStore } from "@nightshift/engine";
import {
	createRunBus,
	createRunHistory,
	createRunLog,
} from "@nightshift/engine/testing";
import { eq } from "drizzle-orm";
import { createDeviceRegistry, setSelfOwner } from "../registry";
import { createHost, type Host } from "./host";

/**
 * This computer as a Host, with Better Auth on its own database: what it
 * tells a joining Device and a Device whose link answers about the Spaces
 * it keeps for its owner, and about its Host admin (ADR 1).
 */

let people: AuthSandbox;
let dataDir: string;
let host: Host;
beforeEach(async () => {
	people = await createAuthSandbox();
	dataDir = mkdtempSync(join(tmpdir(), "nightshift-host-"));
	const log = createRunLog(people.db, { walkerId: "host-a" });
	host = createHost({
		auth: people.auth,
		db: people.db,
		registry: createDeviceRegistry({
			db: people.db,
			log,
			history: createRunHistory({
				db: people.db,
				dataDir,
				log,
				bus: createRunBus(),
			}),
		}),
		settings: {
			current: () => ({ host: true, hostAddresses: [], deviceKeyIdleDays: 30 }),
		} as unknown as SettingsStore,
		self: { id: "host-a", name: "Studio" },
		devicesPage: "https://studio.invalid/devices",
		fingerprint: null,
		disconnect: () => {},
	});
});
afterEach(() => {
	people.cleanup();
	rmSync(dataDir, { recursive: true, force: true });
});

/** Ada is the Host admin, Bob is not. Bob has a shared Space too. */
async function adaAndBob() {
	const ada = await people.signUp("Ada");
	const bob = await people.signUp("Bob");
	await people.db
		.update(user)
		.set({ role: "admin" })
		.where(eq(user.id, ada.userId));
	await people.auth.api.createOrganization({
		headers: bob.headers,
		body: { name: "Platform", slug: "platform" },
	});
	return { ada, bob };
}

/** A Device of `personId` paired with this Host, as its home Host or a guest one. */
async function paired(
	personId: string,
	role: "home" | "guest",
): Promise<DeviceKeyAccess> {
	const deviceId = `device-${role}`;
	await host.registry.join({
		id: deviceId,
		name: role,
		platform: "test",
		ownerId: personId,
		homeHost: role === "home" ? "https://studio.invalid" : null,
	});
	return {
		keyId: `key-${deviceId}`,
		deviceId,
		personId,
		permissions: { sync: ["pull", "push"] },
	};
}

describe("a Device whose link answers", () => {
	test("on its Home Host gets its owner's personal Space; on a Guest Host only the shared Spaces", async () => {
		const { bob } = await adaAndBob();
		const home = await host.hello(await paired(bob.userId, "home"));
		expect(home.spaces.map((s) => [s.name, s.personal])).toEqual([
			["Personal", true],
			["Platform", false],
		]);
		const guest = await host.hello(await paired(bob.userId, "guest"));
		expect(guest.spaces.map((s) => [s.name, s.personal])).toEqual([
			["Platform", false],
		]);
	});

	test("on its Home Host learns its owner's other Devices, and the Host when its owner owns it; never another Person's, never on a Guest Host", async () => {
		const { ada, bob } = await adaAndBob();
		await setSelfOwner(people.db, ada.userId);
		const join = (id: string, ownerId: string, home: boolean) =>
			host.registry.join({
				id,
				name: id,
				platform: "test",
				ownerId,
				homeHost: home ? "https://studio.invalid" : null,
			});
		await join("laptop", ada.userId, true);
		await join("desktop", ada.userId, true);
		await join("old", ada.userId, true);
		await host.registry.revoke("old");
		await join("travel", ada.userId, false);
		await join("bobs", bob.userId, true);
		const key = (deviceId: string, personId: string): DeviceKeyAccess => ({
			keyId: `key-${deviceId}`,
			deviceId,
			personId,
			permissions: { sync: ["pull", "push"] },
		});

		const laptop = await host.hello(key("laptop", ada.userId));
		expect(laptop.devices).toEqual([
			{ id: "host-a", name: "Studio" },
			{ id: "desktop", name: "desktop" },
		]);
		// Bob does not own the Host, and Ada's Devices are not his.
		expect((await host.hello(key("bobs", bob.userId))).devices).toEqual([]);
		// A Guest Host keeps no Device document, so it lists none.
		expect(
			(await host.hello(key("travel", ada.userId))).devices,
		).toBeUndefined();
	});

	test("learns whether its owner is the Host admin", async () => {
		const { ada, bob } = await adaAndBob();
		expect((await host.hello(await paired(ada.userId, "home"))).hostAdmin).toBe(
			true,
		);
		expect(
			(await host.hello(await paired(bob.userId, "guest"))).hostAdmin,
		).toBe(false);
	});
});

describe("a pairing allowed by a Person who is not the Host admin", () => {
	test("says so to that Person before they allow it, and to the joining Device after", async () => {
		const { bob } = await adaAndBob();
		const code = await host.startPairing({
			deviceId: "device-b",
			name: "laptop",
			platform: "darwin",
			home: true,
		});
		const review = await host.review(bob.headers, code.userCode, bob.userId);
		expect(review).toMatchObject({ hostAdmin: false, home: true });
		await host.approve(bob.headers, code.userCode);

		// The pairing plugin answers a poll before its interval with "slow-down".
		await Bun.sleep(code.interval * 1000 + 50);
		const answer = await host.redeemPairing({
			deviceCode: code.deviceCode,
			deviceId: "device-b",
			home: true,
			address: "https://studio.invalid",
		});
		expect(answer).toMatchObject({
			status: "joined",
			personId: bob.userId,
			hostAdmin: false,
		});
	});

	test("from a Device of an older version: the review does not know whether it asks for a home Host", async () => {
		const { ada } = await adaAndBob();
		const code = await host.startPairing({
			deviceId: "device-b",
			name: "laptop",
			platform: "darwin",
		});
		expect(
			await host.review(ada.headers, code.userCode, ada.userId),
		).toMatchObject({ hostAdmin: true, home: null });
	});
});
