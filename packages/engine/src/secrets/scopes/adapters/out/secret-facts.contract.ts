import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { SecretFacts } from "../../application/ports";

/** One store to test: what an adapter of `SecretFacts` gives the suite. */
export type SecretFactsUnderTest = {
	facts: SecretFacts;
	close(): Promise<void>;
};

/**
 * What every adapter of `SecretFacts` does.
 * `secret-facts.contract.test.ts` runs it on the in-memory adapter and on
 * the one over the Device document.
 */
export function secretFactsContract(
	name: string,
	open: () => Promise<SecretFactsUnderTest>,
) {
	describe(`SecretFacts contract: ${name}`, () => {
		let under: SecretFactsUnderTest;
		beforeEach(async () => {
			under = await open();
		});
		afterEach(async () => {
			await under.close();
		});

		test("nothing saved or used reads as empty maps", () => {
			expect([...under.facts.saved()]).toEqual([]);
			expect([...under.facts.usedAt()]).toEqual([]);
		});

		test("the saved names read back sorted, with their times", async () => {
			await under.facts.writeSaved(
				new Map<string, number | null>([
					["ZED", 2],
					["ALPHA", null],
				]),
			);
			expect([...under.facts.saved()]).toEqual([
				["ALPHA", null],
				["ZED", 2],
			]);
		});

		test("the use times read back", async () => {
			await under.facts.writeUsed(new Map([["TOKEN", 60_000]]));
			expect([...under.facts.usedAt()]).toEqual([["TOKEN", 60_000]]);
		});

		test("a forgotten name loses its use time in the same write, the others keep theirs", async () => {
			await under.facts.writeUsed(
				new Map([
					["TOKEN", 1],
					["OTHER", 2],
				]),
			);
			await under.facts.writeSaved(new Map(), ["TOKEN"]);
			expect([...under.facts.usedAt()]).toEqual([["OTHER", 2]]);
		});

		test("a name to forget that was never used changes no use time", async () => {
			await under.facts.writeUsed(new Map([["OTHER", 2]]));
			await under.facts.writeSaved(new Map([["KEPT", 5]]), ["NEVER"]);
			expect([...under.facts.usedAt()]).toEqual([["OTHER", 2]]);
			expect([...under.facts.saved()]).toEqual([["KEPT", 5]]);
		});

		test("a listener hears a change of the saved names until it unsubscribes", async () => {
			let heard = 0;
			const stop = under.facts.onSavedChange(() => {
				heard += 1;
			});
			await under.facts.writeSaved(new Map([["TOKEN", 1]]));
			expect(heard).toBe(1);
			// A use time is no change of the saved names.
			await under.facts.writeUsed(new Map([["TOKEN", 2]]));
			expect(heard).toBe(1);
			stop();
			await under.facts.writeSaved(new Map());
			expect(heard).toBe(1);
		});
	});
}
