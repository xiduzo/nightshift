import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Workplaces } from "../../application/ports";

/** One adapter of `Workplaces` to test. */
export type WorkplacesUnderTest = {
	workplaces: Workplaces;
	/** Makes a folder and returns its path. */
	folder(): Promise<string>;
	/** Makes a file and returns its path. */
	file(): Promise<string>;
	/** A path where nothing is. */
	nothing(): string;
	close(): Promise<void>;
};

/**
 * What every adapter of `Workplaces` does: a folder is there, a file is
 * not a folder, and a path with nothing at it is not there.
 * `workplaces.contract.test.ts` runs it on the in-memory adapter and on
 * the disk.
 */
export function workplacesContract(
	name: string,
	make: () => Promise<WorkplacesUnderTest>,
): void {
	describe(`Workplaces contract: ${name}`, () => {
		let under: WorkplacesUnderTest;
		beforeEach(async () => {
			under = await make();
		});
		afterEach(async () => {
			await under.close();
		});

		test("a folder is there", async () => {
			expect(await under.workplaces.there(await under.folder())).toBe(true);
		});

		test("a file is not a folder", async () => {
			expect(await under.workplaces.there(await under.file())).toBe(false);
		});

		test("a path with nothing at it is not there", async () => {
			expect(await under.workplaces.there(under.nothing())).toBe(false);
		});
	});
}
