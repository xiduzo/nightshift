import { describe, expect, test } from "bun:test";
import { inMemoryPairingPorts } from "../adapters/out/in-memory-neighbours";
import { denyPairing } from "./deny-pairing";
import { reviewPairing } from "./review-pairing";
import { startPairing } from "./start-pairing";

/** The use case denyPairing, on in-memory adapters. The twin of `pairing.test.ts`. */

const ADA = new Headers({ "x-person": "ada" });
const MALLORY = new Headers({ "x-person": "mallory" });

describe("denyPairing", () => {
	test("only the Person who holds the code denies it", async () => {
		const ports = inMemoryPairingPorts();
		const code = await startPairing(ports)({ deviceId: "device-b" });
		await reviewPairing(ports)({ headers: ADA, userCode: code.userCode });
		const deny = denyPairing(ports);
		await expect(
			deny({ headers: MALLORY, userCode: code.userCode }),
		).rejects.toThrow(/Another person/);
		await deny({ headers: ADA, userCode: code.userCode });
		expect(ports.deviceAuthorizations.codes[0]?.status).toBe("denied");
	});
});
