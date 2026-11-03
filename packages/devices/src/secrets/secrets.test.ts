import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { DeviceKeyAccess } from "@nightshift/auth";
import { personalSecret } from "@nightshift/db/schema";
import { HostUnreachableError } from "@nightshift/engine";
import { createSandbox, type Sandbox } from "@nightshift/engine/testing";
import { ORPCError } from "@orpc/server";
import type { HostClient } from "../contract";
import type { HostExchange } from "../exchange";
import type { HostLink } from "../links";
import type { PairedDevice } from "../registry";
import { linksTo } from "../testing/host-in-memory";
import { inMemoryHost } from "../testing/in-memory-host";
import { secretsCipher } from "./cipher";
import { devicePersonalSecrets, OLDER_HOST_SECRETS } from "./device";
import {
	createPersonalSecretsHost,
	NOT_YOUR_DEVICE,
	NOT_YOUR_HOME_HOST,
} from "./host";
import { createPersonalSecretStore } from "./store";

const KEY = "a-secrets-key-for-these-tests-0123456789";

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

const store = () =>
	createPersonalSecretStore({
		db: sandbox.db,
		cipher: secretsCipher(KEY),
		now: () => 1_000,
	});

describe("the cipher", () => {
	test("a value opens with the same key and the same owner and name", async () => {
		const cipher = secretsCipher(KEY);
		const sealed = await cipher.seal("ghp_value", "ann\nGH_TOKEN");
		expect(sealed.ciphertext).not.toContain("ghp_value");
		expect(Buffer.from(sealed.ciphertext, "base64").toString()).not.toContain(
			"ghp_value",
		);
		expect(await cipher.open(sealed, "ann\nGH_TOKEN")).toBe("ghp_value");
		// A new nonce each time.
		const again = await cipher.seal("ghp_value", "ann\nGH_TOKEN");
		expect(again.iv).not.toBe(sealed.iv);
		expect(again.ciphertext).not.toBe(sealed.ciphertext);
	});

	test("it does not open for another owner, another name or another key", async () => {
		const sealed = await secretsCipher(KEY).seal("v", "ann\nGH_TOKEN");
		await expect(
			secretsCipher(KEY).open(sealed, "bob\nGH_TOKEN"),
		).rejects.toThrow();
		await expect(
			secretsCipher(KEY).open(sealed, "ann\nOTHER"),
		).rejects.toThrow();
		await expect(
			secretsCipher(`${KEY}-other`).open(sealed, "ann\nGH_TOKEN"),
		).rejects.toThrow();
	});

	test("a key shorter than 32 characters is refused", () => {
		expect(() => secretsCipher("short")).toThrow("too short");
	});
});

describe("the store", () => {
	test("keeps each Person's values sealed, and lists names and times only", async () => {
		const s = store();
		await s.set("ann", "GH_TOKEN", "ghp_ann", "mac");
		await s.set("bob", "GH_TOKEN", "ghp_bob", "pc");
		await s.set("ann", "GH_TOKEN", "ghp_ann_2", "mac");
		expect(await s.list("ann")).toEqual([{ name: "GH_TOKEN", setAt: 1_000 }]);
		expect(await s.values("ann", ["GH_TOKEN", "NONE"])).toEqual({
			GH_TOKEN: "ghp_ann_2",
		});
		expect(await s.values("bob", ["GH_TOKEN"])).toEqual({
			GH_TOKEN: "ghp_bob",
		});
		const rows = await sandbox.db.select().from(personalSecret);
		expect(JSON.stringify(rows)).not.toContain("ghp_");
		await s.remove("ann", "GH_TOKEN");
		expect(await s.list("ann")).toEqual([]);
		expect(await s.list("bob")).toHaveLength(1);
	});

	test("a value sealed with another key is left out, not given wrong", async () => {
		await store().set("ann", "A", "a", null);
		const other = createPersonalSecretStore({
			db: sandbox.db,
			cipher: secretsCipher(`${KEY}-new`),
		});
		expect(await other.values("ann", ["A"])).toEqual({});
	});
});

/** A Device as this Host's registry has it. */
function paired(fields: Partial<PairedDevice> = {}): PairedDevice {
	return {
		id: "laptop",
		name: "Laptop",
		platform: "darwin",
		ownerId: "ann",
		homeHost: "https://host.example.com",
		lastSeenAt: null,
		online: true,
		pairedAt: 0,
		revokedAt: null,
		...fields,
	};
}

/** A Device key of `deviceId`, for `personId`. */
const keyOf = (deviceId: string, personId: string): DeviceKeyAccess => ({
	keyId: `key-${deviceId}`,
	deviceId,
	personId,
	permissions: { sync: ["pull", "push"] },
});

describe("the Host's half: only the Person's own Devices that call it home", () => {
	function hostOver(devices: PairedDevice[], isHost = true) {
		const s = store();
		const host = createPersonalSecretsHost({
			registry: {
				get: async (id) => devices.find((d) => d.id === id) ?? null,
			},
			store: s,
			isHost: () => isHost,
		});
		return { s, host };
	}

	test("a Device of the Person, paired here as home, sets and reads its Person's values", async () => {
		const { s, host } = hostOver([paired()]);
		const ann = keyOf("laptop", "ann");
		await host.set(ann, { name: "GH_TOKEN", value: "ghp_ann" });
		expect(await host.list(ann)).toEqual([{ name: "GH_TOKEN", setAt: 1_000 }]);
		expect(await host.values(ann, { names: ["GH_TOKEN"] })).toEqual({
			GH_TOKEN: "ghp_ann",
		});
		// Kept for the key's Person, set by its Device.
		const [row] = await sandbox.db.select().from(personalSecret);
		expect([row?.ownerId, row?.setBy]).toEqual(["ann", "laptop"]);
		await host.remove(ann, { name: "GH_TOKEN" });
		expect(await s.list("ann")).toEqual([]);
	});

	test("another Person's Device never gets them: it reads its own Person's only", async () => {
		const { s, host } = hostOver([
			paired(),
			paired({ id: "bobs-pc", ownerId: "bob" }),
		]);
		await s.set("ann", "GH_TOKEN", "ghp_ann", null);
		expect(
			await host.values(keyOf("bobs-pc", "bob"), { names: ["GH_TOKEN"] }),
		).toEqual({});
		expect(await host.list(keyOf("bobs-pc", "bob"))).toEqual([]);
	});

	test.each([
		[
			"a key whose Person does not own the Device",
			keyOf("laptop", "bob"),
			[paired()],
			NOT_YOUR_DEVICE,
		],
		[
			"a Device this Host does not know",
			keyOf("other", "ann"),
			[paired()],
			NOT_YOUR_DEVICE,
		],
		[
			"a Device whose access is removed",
			keyOf("laptop", "ann"),
			[paired({ revokedAt: 5 })],
			NOT_YOUR_DEVICE,
		],
		[
			"a Device that joined as a guest",
			keyOf("laptop", "ann"),
			[paired({ homeHost: null })],
			NOT_YOUR_HOME_HOST,
		],
	] as const)("refuses %s", async (_, key, devices, words) => {
		const { s, host } = hostOver([...devices]);
		await s.set("ann", "GH_TOKEN", "ghp_ann", null);
		await expect(host.values(key, { names: ["GH_TOKEN"] })).rejects.toThrow(
			words,
		);
		await expect(host.list(key)).rejects.toThrow(words);
		await expect(
			host.set(key, { name: "GH_TOKEN", value: "stolen" }),
		).rejects.toThrow(words);
		expect(await s.values("ann", ["GH_TOKEN"])).toEqual({
			GH_TOKEN: "ghp_ann",
		});
	});

	test("refuses every call while Be a Host is off", async () => {
		const { host } = hostOver([paired()], false);
		await expect(host.list(keyOf("laptop", "ann"))).rejects.toThrow(
			"Be a Host",
		);
	});
});

describe("the Device's half", () => {
	const homeLink: HostLink = {
		hostId: "host",
		name: "Host",
		addresses: ["https://host.example.com"],
		certificate: null,
		fingerprint: null,
		role: "home",
		personId: "ann",
		keyStore: "file",
		createdAt: 0,
		revokedAt: null,
	};

	test("without a Home Host, this computer keeps its owner's values itself", async () => {
		const here = store();
		const personal = devicePersonalSecrets({
			hostLinks: { home: async () => null },
			links: () => linksTo(new Map()),
			store: here,
			ownerId: "ann",
			selfId: "mac",
		});
		await personal.set("A", "a");
		expect(await personal.values(["A", "B"])).toEqual({ A: "a" });
		expect(await here.values("ann", ["A"])).toEqual({ A: "a" });
		await personal.remove("A");
		expect(await personal.list()).toEqual([]);
	});

	test("with a Home Host, each call goes there with this Device's key; nothing is kept here", async () => {
		// The Host keeps its own store, in its own database.
		const hostSandbox = await createSandbox();
		try {
			const hostStore = createPersonalSecretStore({
				db: hostSandbox.db,
				cipher: secretsCipher(KEY),
			});
			const host = inMemoryHost({
				exchange: {} as HostExchange,
				hello: () => Promise.reject(new Error("No hello in this test.")),
				personalSecrets: createPersonalSecretsHost({
					registry: { get: async () => paired() },
					store: hostStore,
					isHost: () => true,
				}),
			});
			const client = host.client(keyOf("laptop", "ann"));
			const personal = devicePersonalSecrets({
				hostLinks: { home: async () => homeLink },
				links: () => linksTo(new Map([["host", client]])),
				store: store(),
				ownerId: "local-ann",
				selfId: "laptop",
			});
			await personal.set("GH_TOKEN", "ghp_ann");
			expect(await hostStore.values("ann", ["GH_TOKEN"])).toEqual({
				GH_TOKEN: "ghp_ann",
			});
			expect(await personal.values(["GH_TOKEN"])).toEqual({
				GH_TOKEN: "ghp_ann",
			});
			expect((await personal.list()).map((s) => s.name)).toEqual(["GH_TOKEN"]);
			// This Device's database keeps none.
			expect(await sandbox.db.select().from(personalSecret)).toEqual([]);

			// The network is gone: a use fails, as a Host that cannot be reached.
			host.down();
			await expect(personal.values(["GH_TOKEN"])).rejects.toThrow();
		} finally {
			await hostSandbox.cleanup();
		}
	});

	test("a Home Host without a link, one that is too slow, or an older one", async () => {
		const via = (links: Map<string, HostClient>, deadlineMs = 1_000) =>
			devicePersonalSecrets({
				hostLinks: { home: async () => homeLink },
				links: () => linksTo(links),
				store: store(),
				ownerId: "ann",
				selfId: "laptop",
				deadlineMs,
			});
		await expect(via(new Map()).values(["A"])).rejects.toBeInstanceOf(
			HostUnreachableError,
		);
		const slow = {
			secrets: { values: () => new Promise(() => {}) },
		} as unknown as HostClient;
		await expect(
			via(new Map([["host", slow]]), 20).values(["A"]),
		).rejects.toBeInstanceOf(HostUnreachableError);
		const older = {
			secrets: {
				values: () =>
					Promise.reject(new ORPCError("NOT_FOUND", { status: 404 })),
			},
		} as unknown as HostClient;
		await expect(via(new Map([["host", older]])).values(["A"])).rejects.toThrow(
			OLDER_HOST_SECRETS,
		);
	});
});
