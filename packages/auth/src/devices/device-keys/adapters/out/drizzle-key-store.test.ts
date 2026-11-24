import { beforeEach, describe, expect, test } from "bun:test";
import { migratedDb } from "@nightshift/db/testing";
import type { StoredKey } from "../../domain/device-keys";
import { keySeed } from "../../test-support";
import { drizzleKeyStore } from "./drizzle-key-store";

const B1: StoredKey = {
	id: "key-b1",
	personId: "ada",
	enabled: true,
	expiresAt: 1_000_000,
	permissions: { sync: ["pull", "push"] },
	deviceId: "device-b",
};
const B2: StoredKey = { ...B1, id: "key-b2", expiresAt: null };
const C1: StoredKey = { ...B1, id: "key-c1", deviceId: "device-c" };

const make = async () => {
	const db = await migratedDb();
	return { keyStore: drizzleKeyStore(db), add: keySeed(db) };
};

describe("KeyStore over drizzle", () => {
	let under: Awaited<ReturnType<typeof make>>;
	beforeEach(async () => {
		under = await make();
		await under.add("hash-b1", B1);
		await under.add("hash-b2", B2);
		await under.add("hash-c1", C1);
	});

	test("finds a key by its hash, and nothing for another hash", async () => {
		expect(await under.keyStore.find("hash-b1")).toEqual(B1);
		expect(await under.keyStore.find("hash-b2")).toEqual(B2);
		expect(await under.keyStore.find("no-such-hash")).toBeNull();
	});

	test("lists the keys of a Device, and removes one or several", async () => {
		expect((await under.keyStore.idsOfDevice("device-b")).sort()).toEqual([
			"key-b1",
			"key-b2",
		]);
		await under.keyStore.remove("key-c1");
		expect(await under.keyStore.find("hash-c1")).toBeNull();
		await under.keyStore.removeAll(["key-b1", "key-b2"]);
		expect(await under.keyStore.idsOfDevice("device-b")).toEqual([]);
	});

	test("moves a key's expiry", async () => {
		await under.keyStore.setExpiry("key-b1", 2_000_000);
		expect((await under.keyStore.find("hash-b1"))?.expiresAt).toBe(2_000_000);
	});
});
