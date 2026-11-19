import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { SpaceKeeper } from "../../application/ports";

/** One adapter of `SpaceKeeper` to test. `space-own` is kept here, `space-host` by the Host `host-h`. */
export type SpaceKeeperUnderTest = {
	keeper: SpaceKeeper;
	/** Whether this computer has a Link to the Host of `space-host` now. */
	link(up: boolean): void;
	close(): Promise<void>;
};

/**
 * What every adapter of `SpaceKeeper` does.
 * `space-keeper.contract.test.ts` runs it on the in-memory adapter and on
 * the one over the Device directory and the Links.
 */
export function spaceKeeperContract(
	name: string,
	make: () => Promise<SpaceKeeperUnderTest>,
): void {
	describe(`SpaceKeeper contract: ${name}`, () => {
		let under: SpaceKeeperUnderTest;
		beforeEach(async () => {
			under = await make();
		});
		afterEach(async () => {
			await under.close();
		});

		test("a Space this Replica keeps is not hosted elsewhere, and has no Host to reach", async () => {
			under.link(true);
			expect(await under.keeper.hostedElsewhere("space-own")).toBe(false);
			expect(await under.keeper.hostOf("space-own")).toBeNull();
			expect(await under.keeper.reachable("space-own")).toBe(false);
		});

		test("a Space a Host keeps names its Host, which this computer reaches while its Link is up", async () => {
			expect(await under.keeper.hostedElsewhere("space-host")).toBe(true);
			expect(await under.keeper.hostOf("space-host")).toBe("host-h");
			under.link(true);
			expect(await under.keeper.reachable("space-host")).toBe(true);
			under.link(false);
			expect(await under.keeper.reachable("space-host")).toBe(false);
		});
	});
}
