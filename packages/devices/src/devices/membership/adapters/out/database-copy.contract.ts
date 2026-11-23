import { describe, expect, test } from "bun:test";
import type { DatabaseCopy } from "../../application/ports";

/**
 * What every adapter of `DatabaseCopy` does.
 * `database-copy.contract.test.ts` runs it on both adapters.
 */
export function databaseCopyContract(
	name: string,
	make: () => Promise<DatabaseCopy> | DatabaseCopy,
): void {
	describe(`DatabaseCopy contract: ${name}`, () => {
		test("copy returns a path that names the moment", async () => {
			const port = await make();
			const path = await port.copy("/tmp/data", 1_700_000_000_000);
			expect(path).toContain("before-personal-merge");
		});

		test("copy for a leave names leaving-host", async () => {
			const port = await make();
			const path = await port.copy(
				"/tmp/data",
				1_700_000_000_000,
				"leaving-host",
			);
			expect(path).toContain("before-leaving-host");
		});
	});
}
