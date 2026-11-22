import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ReadMarks } from "../../application/ports";

/** One adapter of `ReadMarks` to test. */
export type ReadMarksUnderTest = {
	marks: ReadMarks;
	/** The marks as a new start of this computer finds them, over the same storage. */
	reopen(): ReadMarks;
	close(): Promise<void>;
};

const PAGE = "https://example.com/docs/a";

/**
 * What every adapter of `ReadMarks` does.
 * `read-marks.contract.test.ts` runs it on the in-memory adapter and on
 * the real one.
 */
export function readMarksContract(
	name: string,
	make: () => Promise<ReadMarksUnderTest>,
): void {
	describe(`ReadMarks contract: ${name}`, () => {
		let under: ReadMarksUnderTest;
		beforeEach(async () => {
			under = await make();
		});
		afterEach(async () => {
			await under.close();
		});

		test("a page never read has no mark", async () => {
			expect(await under.marks.get("p1", "nightshift", PAGE)).toBeNull();
		});

		test("keeps the mark and the links of a read, per project and per reader", async () => {
			const kept = {
				mark: { etag: '"v1"', fingerprint: "f1" },
				links: ["https://example.com/docs/b"],
			};
			await under.marks.set("p1", "nightshift", PAGE, kept);
			expect(await under.marks.get("p1", "nightshift", PAGE)).toEqual(kept);
			expect(await under.marks.get("p1", "jina", PAGE)).toBeNull();
			expect(await under.marks.get("p2", "nightshift", PAGE)).toBeNull();
		});

		test("what was written outlives this computer's start", async () => {
			await under.marks.set("p1", "firecrawl", PAGE, {
				mark: { fingerprint: "f2" },
				links: [],
			});
			await under.marks.flush();
			expect(await under.reopen().get("p1", "firecrawl", PAGE)).toEqual({
				mark: { fingerprint: "f2" },
				links: [],
			});
		});
	});
}
