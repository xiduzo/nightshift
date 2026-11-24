import { describe, expect, test } from "bun:test";
import { DAY_MS } from "@nightshift/time";
import { deviceKeysPorts } from "../test-support";
import { issueKey } from "./issue-key";

/** The use case issueKey, over a database in memory. */

const B = { personId: "ada", deviceId: "device-b", deviceName: "MacBook" };

describe("issueKey", () => {
	test("a key of the Person, with every Device permission, that expires after the idle time", async () => {
		const ports = await deviceKeysPorts();
		const { key, keyId } = await issueKey(ports)(B);
		expect(key.startsWith("nsd_")).toBe(true);
		expect(await ports.byId(keyId)).toMatchObject({
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
		const ports = await deviceKeysPorts();
		const first = await issueKey(ports)(B);
		const second = await issueKey(ports)(B);
		expect(await ports.byId(first.keyId)).toBeNull();
		expect(await ports.byId(second.keyId)).not.toBeNull();
	});
});
