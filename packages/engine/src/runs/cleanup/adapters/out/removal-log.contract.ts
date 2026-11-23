import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { RemovalLog } from "../../application/ports";

/** One adapter of `RemovalLog` to test. */
export type RemovalLogUnderTest = {
	removalLog: RemovalLog;
	close(): Promise<void>;
};

/**
 * What every adapter of `RemovalLog` does.
 * `removal-log.contract.test.ts` runs it on the in-memory adapter and
 * on the real one.
 */
export function removalLogContract(
	name: string,
	make: () => Promise<RemovalLogUnderTest>,
): void {
	describe(`RemovalLog contract: ${name}`, () => {
		let under: RemovalLogUnderTest;
		beforeEach(async () => {
			under = await make();
		});
		afterEach(async () => {
			await under.close();
		});

		test("a project with no removal has none", async () => {
			expect(await under.removalLog.removals("p1")).toEqual([]);
		});

		test("gives the project's removals oldest first, each with its run and who removed it", async () => {
			const { removalLog } = under;
			await removalLog.removed({
				projectId: "p1",
				runId: "run-1",
				worktreePath: "/work/run-1",
				branches: ["nightshift/run-1"],
				kept: ["refs/nightshift/kept/run-1/copy"],
				by: "cleanup",
			});
			await removalLog.removed({
				projectId: "p2",
				runId: "run-2",
				worktreePath: null,
				branches: [],
				by: "cleanup",
			});
			await removalLog.removed({
				projectId: "p1",
				runId: "run-3",
				worktreePath: null,
				branches: [],
				expired: ["refs/nightshift/kept/run-3/copy"],
				by: "person",
			});
			const removals = await removalLog.removals("p1");
			expect(removals.map(({ runId, by }) => ({ runId, by }))).toEqual([
				{ runId: "run-1", by: "cleanup" },
				{ runId: "run-3", by: "person" },
			]);
			for (const removal of removals) {
				expect(typeof removal.at).toBe("number");
			}
			const [first, second] = removals;
			expect(first && second && first.at <= second.at).toBe(true);
			expect(
				(await removalLog.removals("p2")).map((removal) => removal.runId),
			).toEqual(["run-2"]);
		});
	});
}
