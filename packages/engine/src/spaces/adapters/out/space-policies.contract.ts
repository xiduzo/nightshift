import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { SpacePolicies } from "../../application/ports";

/** One adapter of `SpacePolicies` to test, over the Spaces `mine` and `hosted`. */
export type SpacePoliciesUnderTest = {
	spacePolicies: SpacePolicies;
	/** The usage of the Space as its document says: undefined is missing. */
	usageOf(spaceId: string): Promise<boolean | undefined>;
	close(): Promise<void>;
};

/**
 * What every adapter of `SpacePolicies` does. `mine` is a Space this
 * Replica keeps, `hosted` one a Host keeps.
 * `space-policies.contract.test.ts` runs it on the in-memory adapter and
 * on the real one.
 */
export function spacePoliciesContract(
	name: string,
	make: () => Promise<SpacePoliciesUnderTest>,
): void {
	describe(`SpacePolicies contract: ${name}`, () => {
		let under: SpacePoliciesUnderTest;
		beforeEach(async () => {
			under = await make();
		});
		afterEach(async () => {
			await under.close();
		});

		test("usage is on in every Space until one turns it off", async () => {
			const before = await under.spacePolicies.usageOn();
			expect(before.length).toBeGreaterThanOrEqual(2);
			expect(before).not.toContain(false);
			expect(await under.spacePolicies.setUsage("mine", false)).toBe(true);
			expect(await under.usageOf("mine")).toBe(false);
			const after = await under.spacePolicies.usageOn();
			expect(after.filter((on) => !on)).toEqual([false]);
			expect(after).toHaveLength(before.length);
		});

		test("a Space a Host keeps does not change here", async () => {
			expect(await under.spacePolicies.setUsage("hosted", false)).toBe(false);
			expect(await under.usageOf("hosted")).toBeUndefined();
		});
	});
}
