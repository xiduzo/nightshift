import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { LearningFolder } from "../../application/ports";

/** One adapter of `LearningFolder` to test. */
export type LearningFolderUnderTest = {
	folder: LearningFolder;
	close(): Promise<void>;
};

const FILE = "learnings/proposed/run-1.s1.md";

/**
 * What every adapter of `LearningFolder` does.
 * `learning-folder.contract.test.ts` runs it on the in-memory adapter and
 * on the real one.
 */
export function learningFolderContract(
	name: string,
	make: () => Promise<LearningFolderUnderTest>,
): void {
	describe(`LearningFolder contract: ${name}`, () => {
		let under: LearningFolderUnderTest;
		beforeEach(async () => {
			under = await make();
		});
		afterEach(async () => {
			await under.close();
		});

		test("a file never written is not there", async () => {
			expect(await under.folder.has("p1", FILE)).toBe(false);
			expect(await under.folder.bytes("p1", FILE)).toBeNull();
			expect(await under.folder.text("p1", FILE)).toBeNull();
		});

		test("appends to a file, and makes it and its folders first", async () => {
			await under.folder.append("p1", FILE, "- One.\n");
			await under.folder.append(
				"p1",
				FILE,
				new TextEncoder().encode("- Two.\n"),
			);
			expect(await under.folder.has("p1", FILE)).toBe(true);
			expect(await under.folder.text("p1", FILE)).toBe("- One.\n- Two.\n");
			expect(
				new TextDecoder().decode(
					(await under.folder.bytes("p1", FILE)) ?? undefined,
				),
			).toBe("- One.\n- Two.\n");
			expect(await under.folder.has("p2", FILE)).toBe(false);
		});

		test("writes a file whole, and removes it", async () => {
			await under.folder.append("p1", FILE, "- One.\n- Two.\n");
			await under.folder.write("p1", FILE, "- Two.\n");
			expect(await under.folder.text("p1", FILE)).toBe("- Two.\n");
			await under.folder.remove("p1", FILE);
			expect(await under.folder.has("p1", FILE)).toBe(false);
			// Removing a file that is not there does nothing.
			await under.folder.remove("p1", FILE);
		});
	});
}
