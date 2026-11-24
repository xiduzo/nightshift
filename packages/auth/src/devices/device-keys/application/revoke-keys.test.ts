import { describe, expect, test } from "bun:test";
import { deviceKeysPorts } from "../test-support";
import { issueKey } from "./issue-key";
import { revokeKeys } from "./revoke-keys";
import { verifyKey } from "./verify-key";

/** The use case revokeKeys, over a database in memory. */

describe("revokeKeys", () => {
	test("a revoked key is refused at once, even while it is in memory", async () => {
		const ports = await deviceKeysPorts();
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
		const ports = await deviceKeysPorts();
		await revokeKeys(ports)({ deviceId: "device-x" });
		expect(ports.counts.writes).toBe(0);
	});
});
