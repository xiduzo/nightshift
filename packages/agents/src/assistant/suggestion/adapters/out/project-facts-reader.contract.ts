import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ProjectFactsReader } from "../../application/ports";

/** One adapter of `ProjectFactsReader` to test. */
export type ProjectFactsReaderUnderTest = {
	read: ProjectFactsReader;
	/** A folder with a pnpm lock file, a Makefile and the script `lint`. */
	folder: string;
	close(): Promise<void>;
};

/** What every adapter of `ProjectFactsReader` does. */
export function projectFactsReaderContract(
	name: string,
	make: () => Promise<ProjectFactsReaderUnderTest>,
): void {
	describe(`ProjectFactsReader contract: ${name}`, () => {
		let under: ProjectFactsReaderUnderTest;
		beforeEach(async () => {
			under = await make();
		});
		afterEach(() => under.close());

		test("reads the lock file, the scripts and the task files", async () => {
			expect(await under.read(under.folder)).toEqual({
				packageManager: "pnpm",
				scripts: { lint: "biome check" },
				taskFiles: ["Makefile"],
			});
		});

		test("a folder without a project gives nothing, without throwing", async () => {
			expect(await under.read("/nonexistent-ns-folder")).toEqual({
				packageManager: null,
				scripts: {},
				taskFiles: [],
			});
		});
	});
}
