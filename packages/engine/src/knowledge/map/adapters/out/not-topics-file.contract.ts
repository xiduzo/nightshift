import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { NotTopicsFile } from "../../application/ports";

/** One adapter of `NotTopicsFile` to test. */
export type NotTopicsFileUnderTest = {
	notTopicsFile: NotTopicsFile;
	close(): Promise<void>;
};

/**
 * What every adapter of `NotTopicsFile` does.
 * `not-topics-file.contract.test.ts` runs it on the in-memory adapter and
 * on the real one.
 */
export function notTopicsFileContract(
	name: string,
	make: () => Promise<NotTopicsFileUnderTest>,
): void {
	describe(`NotTopicsFile contract: ${name}`, () => {
		let under: NotTopicsFileUnderTest;
		beforeEach(async () => {
			under = await make();
		});
		afterEach(async () => {
			await under.close();
		});

		test("a project with no file reads null", async () => {
			expect(await under.notTopicsFile.read("p1")).toBeNull();
		});

		test("reads back what it wrote, whole, for that project only", async () => {
			await under.notTopicsFile.write("p1", "first\n");
			await under.notTopicsFile.write("p1", "second\n");
			expect(await under.notTopicsFile.read("p1")).toBe("second\n");
			expect(await under.notTopicsFile.read("p2")).toBeNull();
		});
	});
}
