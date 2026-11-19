import { afterEach, describe, expect, test } from "bun:test";
import type { LoggedEvent } from "../../../../log";
import type { WalkHandover } from "../../application/ports";

/** One adapter of `WalkHandover` to test, on one computer. */
export type WalkHandoverUnderTest = {
	handover: WalkHandover;
	/** This computer's id as the Walker of its runs. */
	here: string;
	/**
	 * Puts in a run this computer walks, with walk state: a Checkpoint, and
	 * one step whose transcript holds entries of these seqs.
	 */
	add(
		runId: string,
		seqs: readonly number[],
	): Promise<{ id: string; spaceId: string }>;
	/** The walk state this computer has of the run. Each side compares it only with itself. */
	walkState(runId: string): Promise<unknown>;
	/** This computer loses the run's walk state: as a computer the run moves to, which never had it. */
	wipe(runId: string): Promise<void>;
	/** The next keep cannot reach the Host that keeps the Space. */
	failNextKeep(): void;
	/** Logs a `WalkerMoved` of the run that `from` wrote, and gives it as logged. */
	logMove(runId: string, from: string, to: string): Promise<LoggedEvent>;
	/** This computer logs `WalkerArrived` to the run. */
	logArrival(runId: string, from: string): Promise<void>;
	/** The Walker the run's row names. */
	walkerOf(runId: string): Promise<string>;
	close(): Promise<void>;
};

/** The Device a run moves to and from in the suite. */
const FAR = "device-far";

/**
 * What every adapter of `WalkHandover` does.
 * `walk-handover.contract.test.ts` runs it on the in-memory adapter and on
 * the one over the archive, the walk files and the run log.
 */
export function walkHandoverContract(
	name: string,
	make: () => Promise<WalkHandoverUnderTest>,
): void {
	describe(`WalkHandover contract: ${name}`, () => {
		let under: WalkHandoverUnderTest | null = null;
		afterEach(async () => {
			await under?.close();
			under = null;
		});

		test("what one Walker keeps, the next takes: the same walk state", async () => {
			under = await make();
			const run = await under.add("run-1", [1, 2, 3]);
			const before = await under.walkState(run.id);
			await under.handover.keep(run.id);
			await under.wipe(run.id);
			expect(await under.walkState(run.id)).not.toEqual(before);
			expect(await under.handover.takeCheckpoint(run)).toBe(true);
			expect(await under.handover.takeTranscripts(run)).toBe(3);
			expect(await under.walkState(run.id)).toEqual(before);
		});

		test("without a Checkpoint in the archive there is nothing to take", async () => {
			under = await make();
			const run = await under.add("run-1", [1, 2]);
			expect(await under.handover.takeCheckpoint(run)).toBe(false);
			expect(await under.handover.takeTranscripts(run)).toBe(0);
		});

		test("a keep that cannot reach the Host throws, and keeps nothing", async () => {
			under = await make();
			const run = await under.add("run-1", [1]);
			under.failNextKeep();
			await expect(under.handover.keep(run.id)).rejects.toThrow();
			expect(await under.handover.takeCheckpoint(run)).toBe(false);
		});

		test("the run's row follows its move, and a second time changes nothing", async () => {
			under = await make();
			const run = await under.add("run-1", [1]);
			expect(await under.walkerOf(run.id)).toBe(under.here);
			const moved = await under.logMove(run.id, under.here, FAR);
			await under.handover.moved(moved);
			expect(await under.walkerOf(run.id)).toBe(FAR);
			await under.handover.moved(moved);
			expect(await under.walkerOf(run.id)).toBe(FAR);
		});

		test("a run moved here arrives until this computer writes to it", async () => {
			under = await make();
			const run = await under.add("run-1", [1]);
			expect(await under.handover.arriving(run.id)).toBe(false);
			await under.handover.moved(await under.logMove(run.id, under.here, FAR));
			expect(await under.handover.arriving(run.id)).toBe(false);
			await under.handover.moved(await under.logMove(run.id, FAR, under.here));
			expect(await under.handover.arriving(run.id)).toBe(true);
			await under.logArrival(run.id, FAR);
			expect(await under.handover.arriving(run.id)).toBe(false);
		});
	});
}
