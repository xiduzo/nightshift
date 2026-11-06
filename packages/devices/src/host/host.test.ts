import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DeviceKeyAccess } from "@nightshift/auth";
import { type AuthSandbox, createAuthSandbox } from "@nightshift/auth/testing";
import { user } from "@nightshift/db/schema";
import type { SettingsStore } from "@nightshift/engine/device-config";
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
	const log = createRunLog(people.db, { walkerId: "host-a", dataDir });
	host = createHost({
		auth: people.auth,
		db: people.db,
		registry: createDeviceRegistry({
			db: people.db,
			logFact: async (fact, writes) => {
				await log.append(fact, writes);
			},
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
		forgetClones: async () => {},
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

describe("one computer is one Device", () => {
	const FINGERPRINT = "a".repeat(64);

	/** A pairing that its Person allows, up to the Device's first poll. */
	async function pair(
		person: { headers: Headers; userId: string },
		input: { deviceId: string; machine?: string; home?: boolean },
	) {
		const home = input.home ?? true;
		const code = await host.startPairing({
			deviceId: input.deviceId,
			name: "LE2316",
			platform: "darwin",
			home,
			...(input.machine ? { machine: input.machine } : {}),
		});
		await host.review(person.headers, code.userCode, person.userId);
		await host.approve(person.headers, code.userCode);
		await Bun.sleep(code.interval * 1000 + 50);
		return () =>
			host.redeemPairing({
				deviceCode: code.deviceCode,
				deviceId: input.deviceId,
				home,
				address: "https://studio.invalid",
			});
	}

	test("the same owner on the same computer gets its Device back", async () => {
		const { bob } = await adaAndBob();
		const first = await pair(bob, {
			deviceId: "first",
			machine: FINGERPRINT,
		});
		expect(await first()).toMatchObject({ deviceId: "first" });

		const again = await pair(bob, {
			deviceId: "new-install",
			machine: FINGERPRINT,
		});
		expect(await again()).toMatchObject({
			status: "joined",
			deviceId: "first",
			walkerSeq: expect.any(Number),
		});
		expect(await host.registry.get("new-install")).toBeNull();
		expect((await host.registry.list(bob.userId)).map((d) => d.id)).toEqual([
			"first",
		]);
	});

	test("a removed Device comes back with its access", async () => {
		const { bob } = await adaAndBob();
		await (await pair(bob, { deviceId: "first", machine: FINGERPRINT }))();
		await host.registry.revoke("first");
		const again = await pair(bob, {
			deviceId: "new-install",
			machine: FINGERPRINT,
		});
		expect(await again()).toMatchObject({ deviceId: "first" });
		expect((await host.registry.get("first"))?.revokedAt).toBeNull();
	});

	test("another owner on the same computer never gets that Device", async () => {
		const { ada, bob } = await adaAndBob();
		await (await pair(bob, { deviceId: "bobs", machine: FINGERPRINT }))();
		const adas = await pair(ada, { deviceId: "adas", machine: FINGERPRINT });
		expect(await adas()).toMatchObject({ deviceId: "adas" });
		expect((await host.registry.get("bobs"))?.ownerId).toBe(bob.userId);
	});

	test("another computer gets its own Device", async () => {
		const { bob } = await adaAndBob();
		await (await pair(bob, { deviceId: "first", machine: FINGERPRINT }))();
		const other = await pair(bob, {
			deviceId: "other",
			machine: "b".repeat(64),
		});
		expect(await other()).toMatchObject({ deviceId: "other" });
	});

	test("a Device that says no computer gets its own Device", async () => {
		const { bob } = await adaAndBob();
		await (await pair(bob, { deviceId: "first", machine: FINGERPRINT }))();
		const other = await pair(bob, { deviceId: "other" });
		expect(await other()).toMatchObject({ deviceId: "other" });
	});

	test("a pairing as a guest never uses the computer", async () => {
		const { bob } = await adaAndBob();
		await (await pair(bob, { deviceId: "first", machine: FINGERPRINT }))();
		const guest = await pair(bob, {
			deviceId: "other",
			machine: FINGERPRINT,
			home: false,
		});
		expect(await guest()).toMatchObject({ deviceId: "other" });
	});

	test("while the Night Shift of that Device is connected, the pairing is refused", async () => {
		const { bob } = await adaAndBob();
		await (await pair(bob, { deviceId: "first", machine: FINGERPRINT }))();
		await host.registry.seen("first");
		const again = await pair(bob, {
			deviceId: "new-install",
			machine: FINGERPRINT,
		});
		await expect(again()).rejects.toThrow(
			"Night Shift on this computer is connected to Studio as LE2316. Quit it, then pair again.",
		);
		expect(await host.registry.get("new-install")).toBeNull();
	});
});
