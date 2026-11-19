import { afterEach, describe, expect, test } from "bun:test";
import type { RunLeases } from "../../application/ports";

/** One adapter of `RunLeases` to test. */
export type RunLeasesUnderTest = {
	leases: RunLeases;
	/** The run takes the lease `name`: true when it holds it now. */
	take(runId: string, name: string): Promise<boolean>;
	close(): Promise<void>;
};

/**
 * What every adapter of `RunLeases` does. `run-leases.contract.test.ts`
 * runs it on the in-memory adapter and on the one over the lease keeper.
 */
export function runLeasesContract(
	name: string,
	make: () => Promise<RunLeasesUnderTest>,
): void {
	describe(`RunLeases contract: ${name}`, () => {
		let under: RunLeasesUnderTest | null = null;
		afterEach(async () => {
			await under?.close();
			under = null;
		});

		test("a released lease is free: the next run takes it", async () => {
			under = await make();
			expect(await under.take("run-1", "deploy")).toBe(true);
			expect(await under.take("run-2", "deploy")).toBe(false);
			await under.leases.release("run-1", ["deploy"]);
			expect(await under.take("run-2", "deploy")).toBe(true);
		});

		test("a release lets go of the names it names, and keeps the others", async () => {
			under = await make();
			expect(await under.take("run-1", "deploy")).toBe(true);
			expect(await under.take("run-1", "database")).toBe(true);
			await under.leases.release("run-1", ["deploy"]);
			expect(await under.take("run-2", "deploy")).toBe(true);
			expect(await under.take("run-2", "database")).toBe(false);
		});

		test("a second release changes nothing", async () => {
			under = await make();
			expect(await under.take("run-1", "deploy")).toBe(true);
			await under.leases.release("run-1", ["deploy"]);
			expect(await under.take("run-2", "deploy")).toBe(true);
			await under.leases.release("run-1", ["deploy"]);
			expect(await under.take("run-3", "deploy")).toBe(false);
		});
	});
}
