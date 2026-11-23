import { describe, expect, test } from "bun:test";
import { inMemoryHostPorts } from "../adapters/out/in-memory-neighbours";
import { twinOnlineWords } from "../domain/words";
import { redeemPairing } from "./redeem-pairing";
import { startPairing } from "./start-pairing";

describe("redeemPairing", () => {
	test("an approved code joins the Device and issues a key", async () => {
		const p = inMemoryHostPorts();
		const code = await startPairing(p)({
			deviceId: "laptop",
			name: "LE2316",
			platform: "darwin",
			home: true,
			machine: "aa",
		});
		p.pairings.approveAs(code.deviceCode, "person-bob");
		const answer = await redeemPairing(p)({
			deviceCode: code.deviceCode,
			deviceId: "laptop",
			home: true,
			address: "https://studio.invalid",
		});
		expect(answer).toMatchObject({
			status: "joined",
			deviceId: "laptop",
			personId: "person-bob",
			key: "key-laptop",
		});
		expect(p.keys.issued[0]?.deviceName).toBe("LE2316");
		expect(p.pending.size).toBe(0);
	});

	test("while the twin is linked, pairing is refused", async () => {
		const p = inMemoryHostPorts();
		p.registry.put({
			id: "first",
			name: "LE2316",
			platform: "darwin",
			ownerId: "person-bob",
			homeHost: "https://studio.invalid",
			lastSeenAt: 1,
			online: true,
			pairedAt: 0,
			revokedAt: null,
		});
		const code = await startPairing(p)({
			deviceId: "new-install",
			name: "LE2316",
			platform: "darwin",
			home: true,
			machine: "aa",
		});
		p.pairings.approveAs(code.deviceCode, "person-bob");
		await expect(
			redeemPairing(p)({
				deviceCode: code.deviceCode,
				deviceId: "new-install",
				home: true,
				address: "https://studio.invalid",
			}),
		).rejects.toThrow(twinOnlineWords("Studio", "LE2316"));
		expect(await p.registry.get("new-install")).toBeNull();
	});

	test("the same owner on the same computer gets its Device back", async () => {
		const p = inMemoryHostPorts();
		p.registry.put({
			id: "first",
			name: "LE2316",
			platform: "darwin",
			ownerId: "person-bob",
			homeHost: "https://studio.invalid",
			lastSeenAt: 1,
			online: false,
			pairedAt: 0,
			revokedAt: null,
		});
		p.registry.setWalkerSeq("first", 7);
		const code = await startPairing(p)({
			deviceId: "new-install",
			name: "LE2316",
			platform: "darwin",
			home: true,
			machine: "aa",
		});
		p.pairings.approveAs(code.deviceCode, "person-bob");
		expect(
			await redeemPairing(p)({
				deviceCode: code.deviceCode,
				deviceId: "new-install",
				home: true,
				address: "https://studio.invalid",
			}),
		).toMatchObject({
			deviceId: "first",
			walkerSeq: 7,
		});
	});
});
