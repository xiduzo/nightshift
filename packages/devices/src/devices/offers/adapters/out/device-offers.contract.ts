import { describe, expect, test } from "bun:test";
import type { DeviceOffers } from "../../application/ports";

/**
 * What every adapter of `DeviceOffers` does.
 * `device-offers.contract.test.ts` runs it on the in-memory adapter and
 * on the Device document.
 */
export function deviceOffersContract(
	name: string,
	make: () => Promise<DeviceOffers> | DeviceOffers,
): void {
	describe(`DeviceOffers contract: ${name}`, () => {
		test("set then list returns the Offer with the nameOf name", async () => {
			const port = await make();
			await port.set({
				spaceId: "space-a",
				profile: "prof-1",
				permissionCap: "default",
				sessionCap: 1,
				offeredAt: 100,
			});
			expect(port.list(() => "Agent")).toEqual([
				{
					spaceId: "space-a",
					profile: "prof-1",
					permissionCap: "default",
					sessionCap: 1,
					offeredAt: 100,
					profileName: "Agent",
				},
			]);
		});

		test("list skips an Offer whose profile nameOf does not know", async () => {
			const port = await make();
			await port.set({
				spaceId: "space-a",
				profile: "gone",
				permissionCap: "default",
				sessionCap: 1,
				offeredAt: 1,
			});
			expect(port.list(() => null)).toEqual([]);
		});

		test("remove drops the Offer", async () => {
			const port = await make();
			await port.set({
				spaceId: "space-a",
				profile: "prof-1",
				permissionCap: "default",
				sessionCap: 1,
				offeredAt: 1,
			});
			await port.remove("space-a", "prof-1");
			expect(port.list(() => "Agent")).toEqual([]);
		});
	});
}
