import { describe, expect, test } from "bun:test";
import { inMemoryHostPorts } from "../adapters/out/in-memory-neighbours";
import { denyPairing } from "./deny-pairing";
import { startPairing } from "./start-pairing";

describe("denyPairing", () => {
	test("denies the code the Person reviewed", async () => {
		const p = inMemoryHostPorts();
		const code = await startPairing(p)({
			deviceId: "laptop",
			name: "LE2316",
			platform: "darwin",
		});
		await denyPairing(p)({
			headers: new Headers(),
			userCode: code.userCode,
		});
		expect([...p.pairings.codes.values()][0]?.status).toBe("denied");
	});
});
