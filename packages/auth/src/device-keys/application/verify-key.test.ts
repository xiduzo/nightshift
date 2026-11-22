import { describe, expect, test } from "bun:test";
import { DAY_MS } from "@nightshift/time";
import { inMemoryDeviceKeysPorts } from "../adapters/out/in-memory-neighbours";
import { issueKey } from "./issue-key";
import { verifyKey } from "./verify-key";

/** The use case verifyKey, on in-memory adapters. The twins of `pairing.test.ts`. */

async function withKey() {
	const ports = inMemoryDeviceKeysPorts();
	const issued = await issueKey(ports)({
		personId: "ada",
		deviceId: "device-b",
		deviceName: "MacBook",
	});
	return { ports, ...issued, verify: verifyKey(ports) };
}

describe("verifyKey", () => {
	test("a key resolves to its Device and Person, and only allows its own permissions", async () => {
		const { ports, key, verify } = await withKey();
		expect(await verify({ key, need: "sync" })).toMatchObject({
			deviceId: "device-b",
			personId: "ada",
		});
		const id = ports.keyStore.byId((await verify({ key }))?.keyId ?? "");
		if (id) id.permissions = { sync: ["pull"] };
		ports.clock.now += 61_000;
		expect(await verify({ key, need: "sync" })).toBeNull();
	});

	test("a wrong key and a session token are refused", async () => {
		const { ports, key, verify } = await withKey();
		expect(await verify({ key: `${key}x` })).toBeNull();
		expect(await verify({ key: "a-session-token" })).toBeNull();
		expect(ports.keyStore.reads).toBe(2);
	});

	test("a verified key is kept in memory: later calls read and write nothing", async () => {
		const { ports, key, verify } = await withKey();
		const { reads, writes } = ports.keyStore;
		expect(await verify({ key, need: "sync" })).not.toBeNull();
		expect(await verify({ key })).not.toBeNull();
		expect(ports.keyStore.reads - reads).toBe(1);
		expect(ports.keyStore.writes - writes).toBe(0);
	});

	test("a key unused for longer than the idle time expires; a use moves it on", async () => {
		const { ports, key, keyId, verify } = await withKey();
		const stored = ports.keyStore.byId(keyId);
		if (!stored) throw new Error("no key");
		stored.expiresAt = ports.clock.now + 28 * DAY_MS;
		expect(await verify({ key })).not.toBeNull();
		expect(stored.expiresAt).toBe(ports.clock.now + 30 * DAY_MS);

		ports.clock.now = (stored.expiresAt ?? 0) + 1_000;
		expect(await verify({ key })).toBeNull();
		expect(ports.keyStore.byId(keyId)).toBeNull();
	});
});
