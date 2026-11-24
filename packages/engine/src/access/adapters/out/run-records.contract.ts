import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { RunRecords } from "../../application/ports";

/** One adapter of `RunRecords` to test, over the runs of one Replica. */
export type RunRecordsUnderTest = {
	records: RunRecords;
	/** Two Spaces runs can be in. */
	spaceId: string;
	otherSpaceId: string;
	/** Adds a run of a project of `spaceId`, walked by this computer. */
	add(run: { id: string; spaceId: string }): Promise<void>;
	/** Moves the run's walk to the Device `to`, as a `WalkerMoved` does. */
	moveAway(runId: string, to: string): Promise<void>;
	close(): Promise<void>;
};

/**
 * What every adapter of `RunRecords` does.
 * `run-records.contract.test.ts` runs it on the in-memory adapter and on
 * the one over the run log.
 */
export function runRecordsContract(
	name: string,
	make: () => Promise<RunRecordsUnderTest>,
): void {
	describe(`RunRecords contract: ${name}`, () => {
		let under: RunRecordsUnderTest;
		beforeEach(async () => {
			under = await make();
		});
		afterEach(async () => {
			await under.close();
		});

		test("an unknown id is null", async () => {
			expect(await under.records.find("run-nobody-has")).toBeNull();
		});

		test("a run carries the Space of its project", async () => {
			await under.add({ id: "run-1", spaceId: under.spaceId });
			await under.add({ id: "run-2", spaceId: under.otherSpaceId });
			expect((await under.records.find("run-1"))?.spaceId).toBe(under.spaceId);
			expect((await under.records.find("run-2"))?.spaceId).toBe(
				under.otherSpaceId,
			);
			expect((await under.records.find("run-1"))?.id).toBe("run-1");
		});

		test("walkedHere follows a WalkerMoved", async () => {
			await under.add({ id: "run-1", spaceId: under.spaceId });
			const before = await under.records.find("run-1");
			if (!before) throw new Error("the run is not there");
			expect(await under.records.walkedHere(before)).toBe(true);

			await under.moveAway("run-1", "device-elsewhere");
			const after = await under.records.find("run-1");
			if (!after) throw new Error("the run is not there");
			expect(after.walkerId).toBe("device-elsewhere");
			expect(await under.records.walkedHere(after)).toBe(false);
		});
	});
}
