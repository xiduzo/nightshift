import { describe, expect, test } from "bun:test";
import { inMemoryHostPorts } from "../adapters/out/in-memory-neighbours";
import { approvePairing } from "./approve-pairing";
import { startPairing } from "./start-pairing";

describe("approvePairing", () => {
	test("approves the code the Person reviewed", async () => {
		const p = inMemoryHostPorts();
		const code = await startPairing(p)({
			deviceId: "laptop",
			name: "LE2316",
			platform: "darwin",
			home: true,
		});
		await approvePairing(p)({
			headers: new Headers(),
			userCode: code.userCode,
		});
		expect([...p.pairings.codes.values()][0]?.status).toBe("approved");
	});
});
