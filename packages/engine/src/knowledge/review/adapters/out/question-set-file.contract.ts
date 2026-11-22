import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { QuestionSetFile } from "../../application/ports";

/** One adapter of `QuestionSetFile` to test. */
export type QuestionSetFileUnderTest = {
	questionSetFile: QuestionSetFile;
	close(): Promise<void>;
};

/**
 * What every adapter of `QuestionSetFile` does.
 * `question-set-file.contract.test.ts` runs it on the in-memory adapter and
 * on the real one.
 */
export function questionSetFileContract(
	name: string,
	make: () => Promise<QuestionSetFileUnderTest>,
): void {
	describe(`QuestionSetFile contract: ${name}`, () => {
		let under: QuestionSetFileUnderTest;
		beforeEach(async () => {
			under = await make();
		});
		afterEach(async () => {
			await under.close();
		});

		test("a project with no file reads null", async () => {
			expect(await under.questionSetFile.read("p1")).toBeNull();
		});

		test("reads back what it wrote, whole, for that project only", async () => {
			await under.questionSetFile.write("p1", "first\n");
			await under.questionSetFile.write("p1", "second\n");
			expect(await under.questionSetFile.read("p1")).toBe("second\n");
			expect(await under.questionSetFile.read("p2")).toBeNull();
		});
	});
}
