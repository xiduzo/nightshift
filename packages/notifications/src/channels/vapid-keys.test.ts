import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Database } from "@nightshift/db";

import { fakeVapidKeys } from "../testing";
import { testDatabase } from "../testing/database";
import { createVapidKeyStore } from "./vapid-keys";

/** The VAPID keys are made once and kept: a browser's subscription depends on them. */

let db: Database;
let cleanup: () => void;
beforeEach(async () => {
	({ db, cleanup } = await testDatabase());
});
afterEach(() => cleanup());

test("makes the key pair once, and keeps it", async () => {
	const keys = fakeVapidKeys();
	const store = createVapidKeyStore(db, keys.generate);

	const [first, second] = await Promise.all([store.get(), store.get()]);
	expect(first).toEqual({ publicKey: "public-1", privateKey: "private-1" });
	expect(second).toEqual(first);
	expect(keys.made).toBe(1);

	// A daemon that starts again reads the same pair.
	const again = createVapidKeyStore(db, keys.generate);
	expect(await again.get()).toEqual(first);
	expect(keys.made).toBe(1);
});

test("two daemons on one database keep the pair saved first", async () => {
	const keys = fakeVapidKeys();
	const one = createVapidKeyStore(db, keys.generate);
	const two = createVapidKeyStore(db, keys.generate);

	const [a, b] = await Promise.all([one.get(), two.get()]);
	expect(b).toEqual(a);
});

test("makes a real P-256 key pair by default", async () => {
	const { publicKey, privateKey } = await createVapidKeyStore(db).get();
	// 65 bytes uncompressed and 32 bytes, URL-safe base64.
	expect(Buffer.from(publicKey, "base64url")).toHaveLength(65);
	expect(Buffer.from(privateKey, "base64url")).toHaveLength(32);
});
