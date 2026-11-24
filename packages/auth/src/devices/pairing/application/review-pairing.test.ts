import { describe, expect, test } from "bun:test";
import { inMemoryPairingPorts } from "../adapters/out/in-memory-neighbours";
import { reviewPairing } from "./review-pairing";
import { startPairing } from "./start-pairing";

/** The use case reviewPairing, on in-memory adapters. */

const ADA = new Headers({ "x-person": "ada" });
const MALLORY = new Headers({ "x-person": "mallory" });

describe("reviewPairing", () => {
	test("the first Person who reviews a code holds it, typed in any case and with a dash", async () => {
		const ports = inMemoryPairingPorts();
		const code = await startPairing(ports)({ deviceId: "device-b" });
		const typed = `${code.userCode.slice(0, 4)}-${code.userCode.slice(4)}`;
		const review = reviewPairing(ports);
		expect(
			await review({ headers: ADA, userCode: typed.toLowerCase() }),
		).toEqual({
			userCode: code.userCode,
			status: "pending",
			deviceId: "device-b",
		});
		await expect(
			review({ headers: MALLORY, userCode: code.userCode }),
		).rejects.toThrow(/Another person/);
	});

	test("a review needs a session, and a known code", async () => {
		const ports = inMemoryPairingPorts();
		const code = await startPairing(ports)({ deviceId: "device-b" });
		const review = reviewPairing(ports);
		await expect(
			review({ headers: new Headers(), userCode: code.userCode }),
		).rejects.toThrow(/Another person/);
		await expect(
			review({ headers: ADA, userCode: "ZZZZZZZZ" }),
		).rejects.toThrow(/No device waits with this code/);
	});
});
