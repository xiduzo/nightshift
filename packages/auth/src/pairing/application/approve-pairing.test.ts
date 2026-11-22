import { describe, expect, test } from "bun:test";
import { inMemoryPairingPorts } from "../adapters/out/in-memory-neighbours";
import { approvePairing } from "./approve-pairing";
import { reviewPairing } from "./review-pairing";
import { startPairing } from "./start-pairing";

/** The use case approvePairing, on in-memory adapters. The twins of `pairing.test.ts`. */

const ADA = new Headers({ "x-person": "ada" });
const MALLORY = new Headers({ "x-person": "mallory" });

describe("approvePairing", () => {
	test("an approval needs a review first, by the same Person", async () => {
		const ports = inMemoryPairingPorts();
		const code = await startPairing(ports)({ deviceId: "device-b" });
		const approve = approvePairing(ports);
		await expect(
			approve({ headers: ADA, userCode: code.userCode }),
		).rejects.toThrow(/Enter the code first/);
		await reviewPairing(ports)({ headers: ADA, userCode: code.userCode });
		await expect(
			approve({ headers: MALLORY, userCode: code.userCode }),
		).rejects.toThrow(/Another person/);
		await approve({ headers: ADA, userCode: code.userCode.toLowerCase() });
		expect(ports.deviceAuthorizations.codes[0]?.status).toBe("approved");
	});
});
