import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { DeviceKeyAccess } from "@nightshift/auth";
import { personalSecret } from "@nightshift/db/schema";
import { createSandbox, type Sandbox } from "@nightshift/engine/testing";
import type { HostExchange } from "../exchange";
import type { HostLink } from "../links";
import { admitEvery } from "../testing";
import { linksTo } from "../testing/host-in-memory";
import { inMemoryHost } from "../testing/in-memory-host";
import { wireKept } from "./kept";
import { KEY, secretsOf } from "./test-support";

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

const store = () =>
	wireKept({ db: sandbox.db, secretsKey: KEY, now: () => 1_000 }).personal;

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
		const other = wireKept({
			db: sandbox.db,
			secretsKey: `${KEY}-new`,
		}).personal;
		expect(await other.values("ann", ["A"])).toEqual({});
	});
});

/** A Device key of `deviceId`, for `personId`. */
const keyOf = (deviceId: string, personId: string): DeviceKeyAccess => ({
	keyId: `key-${deviceId}`,
	deviceId,
	personId,
	permissions: { sync: ["pull", "push"] },
});

const HOME = "https://host.example.com";

describe("the Device's half", () => {
	const homeLink: HostLink = {
		hostId: "host",
		name: "Host",
		addresses: [HOME],
		certificate: null,
		fingerprint: null,
		role: "home",
		personId: "ann",
		keyStore: "file",
		createdAt: 0,
		revokedAt: null,
	};

	test("with a Home Host, each call goes there with this Device's key; nothing is kept here", async () => {
		// The Host keeps its own store, in its own database.
		const hostSandbox = await createSandbox();
		try {
			const hostStore = wireKept({
				db: hostSandbox.db,
				secretsKey: KEY,
			}).personal;
			const host = inMemoryHost({
				exchange: {} as HostExchange,
				hello: () => Promise.reject(new Error("No hello in this test.")),
				// The Host admits the laptop as paired here, as its Home Host.
				admit: admitEvery({ device: { homeHost: HOME } }),
				personalSecrets: secretsOf({ db: hostSandbox.db }).ofDevices
					.personalSecrets,
			});
			const client = host.client(keyOf("laptop", "ann"));
			const personal = secretsOf({
				db: sandbox.db,
				hostLinks: { home: async () => homeLink },
				links: () => linksTo(new Map([["host", client]])),
				ownerId: "local-ann",
				selfId: "laptop",
			}).personalSecrets;
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
});
