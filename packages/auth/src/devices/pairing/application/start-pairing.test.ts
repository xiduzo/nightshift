import { describe, expect, test } from "bun:test";
import { inMemoryPairingPorts } from "../adapters/out/in-memory-neighbours";
import { startPairing } from "./start-pairing";

/** The use case startPairing, on in-memory adapters. */

describe("startPairing", () => {
	test("a new code for the Device, which waits", async () => {
		const ports = inMemoryPairingPorts();
		const code = await startPairing(ports)({ deviceId: "device-b" });
		expect(code.userCode).toMatch(/^[A-Z0-9]{8}$/);
		expect(ports.deviceAuthorizations.codes).toMatchObject([
			{ deviceId: "device-b", status: "pending" },
		]);
	});
});
