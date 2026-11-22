import { describe, expect, test } from "bun:test";
import { inMemoryDeviceKeysPorts } from "../adapters/out/in-memory-neighbours";
import { issueKey } from "./issue-key";
import { revokeKeys } from "./revoke-keys";
import { verifyKey } from "./verify-key";

/** The use case revokeKeys, on in-memory adapters. */

describe("revokeKeys", () => {
	test("a revoked key is refused at once, even while it is in memory", async () => {
		const ports = inMemoryDeviceKeysPorts();
		const { key } = await issueKey(ports)({
			personId: "ada",
			deviceId: "device-b",
			deviceName: "MacBook",
		});
		const verify = verifyKey(ports);
		expect(await verify({ key })).not.toBeNull();
		await revokeKeys(ports)({ deviceId: "device-b" });
		expect(await verify({ key })).toBeNull();
	});

	test("a Device without keys deletes nothing", async () => {
		const ports = inMemoryDeviceKeysPorts();
		await revokeKeys(ports)({ deviceId: "device-x" });
		expect(ports.keyStore.writes).toBe(0);
	});
});
