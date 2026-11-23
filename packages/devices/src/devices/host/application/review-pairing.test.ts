import { describe, expect, test } from "bun:test";
import { inMemoryHostPorts } from "../adapters/out/in-memory-neighbours";
import { reviewPairing } from "./review-pairing";
import { startPairing } from "./start-pairing";

describe("reviewPairing", () => {
	test("shows the Device that asked, and whether the Person is the Host admin", async () => {
		const p = inMemoryHostPorts();
		p.spaces.admins.add("person-ada");
		const code = await startPairing(p)({
			deviceId: "laptop",
			name: "LE2316",
			platform: "darwin",
			home: true,
		});
		const review = await reviewPairing(p)({
			headers: new Headers(),
			userCode: code.userCode,
			personId: "person-ada",
		});
		expect(review).toMatchObject({
			hostAdmin: true,
			home: true,
			device: { id: "laptop", name: "LE2316", platform: "darwin" },
		});
	});

	test("an older Device that did not say home leaves home null", async () => {
		const p = inMemoryHostPorts();
		const code = await startPairing(p)({
			deviceId: "laptop",
			name: "LE2316",
			platform: "darwin",
		});
		expect(
			await reviewPairing(p)({
				headers: new Headers(),
				userCode: code.userCode,
				personId: "person-bob",
			}),
		).toMatchObject({ hostAdmin: false, home: null });
	});
});
