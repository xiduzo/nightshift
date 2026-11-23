import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import { NOT_A_HOST } from "../../contract";
import { inMemoryHostPorts } from "../adapters/out/in-memory-neighbours";
import { SELF_PAIR } from "../domain/words";
import { startPairing } from "./start-pairing";

describe("startPairing", () => {
	test("a Host gives a code and stores the Device under it", async () => {
		const p = inMemoryHostPorts();
		const code = await startPairing(p)({
			deviceId: "laptop",
			name: "LE2316",
			platform: "darwin",
			home: true,
		});
		expect(code.userCode).toBe("UC1");
		expect(code.verificationUriComplete).toContain("pair=UC1");
		expect(p.pending.get(code.deviceCode)?.name).toBe("LE2316");
	});

	test("refuses a computer pairing with itself, and while Be a Host is off", async () => {
		const p = inMemoryHostPorts();
		await expect(
			startPairing(p)({
				deviceId: "host-a",
				name: "Studio",
				platform: "darwin",
			}),
		).rejects.toThrow(SELF_PAIR);
		p.settings.enabled = false;
		await expect(
			startPairing(p)({
				deviceId: "laptop",
				name: "LE2316",
				platform: "darwin",
			}),
		).rejects.toBeInstanceOf(Refusal);
		p.settings.enabled = false;
		await expect(
			startPairing(p)({
				deviceId: "laptop",
				name: "LE2316",
				platform: "darwin",
			}),
		).rejects.toThrow(NOT_A_HOST);
	});
});
