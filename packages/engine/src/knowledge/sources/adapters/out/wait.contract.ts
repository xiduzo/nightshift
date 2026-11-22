import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Wait } from "../../application/ports";

/** One adapter of `Wait` to test. */
export type WaitUnderTest = {
	wait: Wait;
	close(): Promise<void>;
};

/**
 * What every adapter of `Wait` does.
 * `wait.contract.test.ts` runs it on the in-memory adapter and on the
 * real one.
 */
export function waitContract(
	name: string,
	make: () => Promise<WaitUnderTest>,
): void {
	describe(`Wait contract: ${name}`, () => {
		let under: WaitUnderTest;
		beforeEach(async () => {
			under = await make();
		});
		afterEach(async () => {
			await under.close();
		});

		test("a short wait ends", async () => {
			expect(await under.wait.wait(1)).toBeUndefined();
		});
	});
}
