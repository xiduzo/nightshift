import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type DeviceKeyAccess, ROLE_REFUSAL } from "@nightshift/auth";
import { type AuthSandbox, createAuthSandbox } from "@nightshift/auth/testing";
import { user } from "@nightshift/db/schema";
import type { SettingsStore } from "@nightshift/engine/settings";
import {
	createRunBus,
	createRunHistory,
	createRunLog,
	deviceRowsOn,
} from "@nightshift/engine/testing";
import { eq } from "drizzle-orm";
import { wireRegistry } from "../registry";
import { type Host, wireHost } from "./wire";

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
	host = wireHost({
		auth: people.auth,
		db: people.db,
		registry: wireRegistry({ db: people.db }).paired({
			deviceRows: deviceRowsOn(people.db),
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
	}, 15_000);
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
	}, 15_000);
});

describe("the Caller of a keyed call", () => {
	test("is the key with its Device as paired, and its Person's roles from the member rows", async () => {
		const { ada, bob } = await adaAndBob();
		const platform = await people.auth.api.createOrganization({
			headers: ada.headers,
			body: { name: "Shared", slug: "shared" },
		});
		const spaceId = platform?.id ?? "";
		await people.auth.api.addMember({
			body: { userId: bob.userId, role: "viewer", organizationId: spaceId },
		});
		const key = await paired(bob.userId, "home");
		const caller = await host.admit(key, "sync");
		expect(caller).toMatchObject({
			...key,
			device: { name: "home", homeHost: "https://studio.invalid" },
		});
		expect(await caller.spaces()).toContain(spaceId);
		expect(await caller.roleIn(spaceId)).toBe("viewer");
		expect(await caller.member("space-none")).toBe(false);
		await expect(caller.may(spaceId, { run: ["start"] })).rejects.toMatchObject(
			{
				code: "FORBIDDEN",
				message: ROLE_REFUSAL.message,
			},
		);
		const owner = await host.admit(await paired(ada.userId, "guest"), "sync");
		await expect(
			owner.may(spaceId, { run: ["start"] }),
		).resolves.toBeUndefined();
		await host.registry.revoke(key.deviceId);
		await expect(host.admit(key, "sync")).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
	});
});
