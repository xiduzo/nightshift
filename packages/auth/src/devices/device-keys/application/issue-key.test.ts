import { describe, expect, test } from "bun:test";
import { DAY_MS } from "@nightshift/time";
import { inMemoryDeviceKeysPorts } from "../adapters/out/in-memory-neighbours";
import { issueKey } from "./issue-key";

/** The use case issueKey, on in-memory adapters. The twins of `pairing.test.ts`. */

const B = { personId: "ada", deviceId: "device-b", deviceName: "MacBook" };

describe("issueKey", () => {
	test("a key of the Person, with every Device permission, that expires after the idle time", async () => {
		const ports = inMemoryDeviceKeysPorts();
		const { key, keyId } = await issueKey(ports)(B);
		expect(key.startsWith("nsd_")).toBe(true);
		expect(ports.keyStore.byId(keyId)).toMatchObject({
			personId: "ada",
			deviceId: "device-b",
			permissions: {
				sync: ["pull", "push"],
				relay: ["serve"],
				archive: ["put", "get"],
			},
			expiresAt: ports.clock.now + 30 * DAY_MS,
		});
	});

	test("pairing again replaces the Device's key", async () => {
		const ports = inMemoryDeviceKeysPorts();
		const first = await issueKey(ports)(B);
		const second = await issueKey(ports)(B);
		expect(ports.keyStore.byId(first.keyId)).toBeNull();
		expect(ports.keyStore.byId(second.keyId)).not.toBeNull();
	});
});
