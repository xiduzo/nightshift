import { describe, expect, test } from "bun:test";
import { inMemoryPairingPorts } from "../adapters/out/in-memory-neighbours";
import { approvePairing } from "./approve-pairing";
import { denyPairing } from "./deny-pairing";
import { redeemPairing } from "./redeem-pairing";
import { reviewPairing } from "./review-pairing";
import { startPairing } from "./start-pairing";

/** The use case redeemPairing, on in-memory adapters. */

const ADA = new Headers({ "x-person": "ada" });

async function started() {
	const ports = inMemoryPairingPorts();
	const code = await startPairing(ports)({ deviceId: "device-b" });
	await reviewPairing(ports)({ headers: ADA, userCode: code.userCode });
	const pending = { deviceCode: code.deviceCode, deviceId: "device-b" };
	return { ports, code, pending, redeem: redeemPairing(ports) };
}

describe("redeemPairing", () => {
	test("the Device waits, then learns who approved; no token is kept", async () => {
		const { ports, code, pending, redeem } = await started();
		expect(await redeem(pending)).toEqual({ status: "pending" });
		await approvePairing(ports)({ headers: ADA, userCode: code.userCode });
		expect(await redeem(pending)).toEqual({
			status: "approved",
			personId: "ada",
		});
		expect(ports.deviceAuthorizations.tokens.size).toBe(0);
		// The device code is used up.
		await expect(redeem(pending)).rejects.toThrow(/not valid/);
	});

	test("a denied code ends the Device's wait", async () => {
		const { ports, code, pending, redeem } = await started();
		await denyPairing(ports)({ headers: ADA, userCode: code.userCode });
		expect(await redeem(pending)).toEqual({ status: "denied" });
	});

	test("another Device cannot redeem the code", async () => {
		const { ports, code, redeem } = await started();
		await approvePairing(ports)({ headers: ADA, userCode: code.userCode });
		await expect(
			redeem({ deviceCode: code.deviceCode, deviceId: "another-device" }),
		).rejects.toThrow(/not valid/);
	});
});
