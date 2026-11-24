import { describe, expect, test } from "bun:test";
import { DAY_MS } from "@nightshift/time";
import { deviceKeysPorts } from "../test-support";
import { issueKey } from "./issue-key";
import { verifyKey } from "./verify-key";

/** The use case verifyKey, over a database in memory. */

async function withKey() {
	const ports = await deviceKeysPorts();
	const issued = await issueKey(ports)({
		personId: "ada",
		deviceId: "device-b",
		deviceName: "MacBook",
	});
	return { ports, ...issued, verify: verifyKey(ports) };
}

describe("verifyKey", () => {
	test("a key resolves to its Device and Person, and only allows its own permissions", async () => {
		const { ports, key, keyId, verify } = await withKey();
		expect(await verify({ key, need: "sync" })).toMatchObject({
			deviceId: "device-b",
			personId: "ada",
		});
		expect((await verify({ key }))?.keyId).toBe(keyId);
		await ports.allow(keyId, { sync: ["pull"] });
		ports.clock.now += 61_000;
		expect(await verify({ key, need: "sync" })).toBeNull();
	});

	test("a wrong key and a session token are refused", async () => {
		const { ports, key, verify } = await withKey();
		expect(await verify({ key: `${key}x` })).toBeNull();
		expect(await verify({ key: "a-session-token" })).toBeNull();
		expect(ports.counts.reads).toBe(2);
	});

	test("a verified key is kept in memory: later calls read and write nothing", async () => {
		const { ports, key, verify } = await withKey();
		const { reads, writes } = ports.counts;
		expect(await verify({ key, need: "sync" })).not.toBeNull();
		expect(await verify({ key })).not.toBeNull();
		expect(ports.counts.reads - reads).toBe(1);
		expect(ports.counts.writes - writes).toBe(0);
	});

	test("a key unused for longer than the idle time expires; a use moves it on", async () => {
		const { ports, key, keyId, verify } = await withKey();
		await ports.expire(keyId, ports.clock.now + 28 * DAY_MS);
		expect(await verify({ key })).not.toBeNull();
		const moved = ports.clock.now + 30 * DAY_MS;
		expect((await ports.byId(keyId))?.expiresAt).toBe(moved);

		ports.clock.now = moved + 1_000;
		expect(await verify({ key })).toBeNull();
		expect(await ports.byId(keyId)).toBeNull();
	});
});
