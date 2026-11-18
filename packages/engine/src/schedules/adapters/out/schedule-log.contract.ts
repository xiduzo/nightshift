import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ScheduleLog } from "../../application/ports";
import type { ScheduleHistory } from "../../domain/schedule-history";

/** One log to test: what an adapter of `ScheduleLog` gives the suite. */
export type ScheduleLogUnderTest = {
	/** Two projects the log can write facts of. */
	projectId: string;
	otherProjectId: string;
	/**
	 * A log over the facts of this test. Each call gives a new one over
	 * the same facts: a daemon that starts again.
	 */
	open(): ScheduleLog;
	/** Logs the start of a run with the schedule as its trigger, as a run's start does. */
	runStarted(fact: {
		projectId: string;
		scheduleId: string;
		at: number;
		runId: string;
	}): Promise<void>;
	close(): Promise<void>;
};

/**
 * What every adapter of `ScheduleLog` does. `schedule-log.contract.test.ts`
 * runs it on the in-memory adapter and on the drizzle one.
 */
export function scheduleLogContract(
	name: string,
	make: () => Promise<ScheduleLogUnderTest>,
): void {
	describe(`ScheduleLog contract: ${name}`, () => {
		let under: ScheduleLogUnderTest;
		let log: ScheduleLog;
		let P: string;
		const S = "nightly";

		beforeEach(async () => {
			under = await make();
			log = under.open();
			P = under.projectId;
		});
		afterEach(async () => {
			await under.close();
		});

		test("knows nothing of a schedule without a fact", async () => {
			expect((await log.histories()).of(P, S)).toBeUndefined();
			expect(await log.deliveries(P, S, 10)).toEqual([]);
		});

		test("a fired fact shows at once, with its run", async () => {
			const histories = await log.histories();
			await log.fired({
				projectId: P,
				scheduleId: S,
				at: 100,
				runId: "run-1",
				error: null,
			});
			// The view read before the fact is live.
			expect(histories.of(P, S)).toEqual({
				lastAt: 100,
				last: { kind: "fired", at: 100, runId: "run-1" },
				runIds: ["run-1"],
			});
			expect((await log.histories()).of(P, S)).toEqual({
				lastAt: 100,
				last: { kind: "fired", at: 100, runId: "run-1" },
				runIds: ["run-1"],
			});
		});

		test("a start that failed shows as failed, with its words", async () => {
			await log.fired({
				projectId: P,
				scheduleId: S,
				at: 100,
				runId: null,
				error: 'The flow "gone" does not exist.',
			});
			expect((await log.histories()).of(P, S)).toEqual({
				lastAt: 100,
				last: {
					kind: "failed",
					at: 100,
					error: 'The flow "gone" does not exist.',
				},
				runIds: [],
			});
		});

		test("a skipped fact shows at once, with its reason and the run that still ran", async () => {
			const histories = await log.histories();
			await log.skipped({
				projectId: P,
				scheduleId: S,
				at: 100,
				reason: "An earlier run of this schedule is still waiting.",
				runId: "run-1",
			});
			const skipped: ScheduleHistory = {
				lastAt: 100,
				last: {
					kind: "skipped",
					at: 100,
					reason: "An earlier run of this schedule is still waiting.",
					runId: "run-1",
				},
				runIds: [],
			};
			expect(histories.of(P, S)).toEqual(skipped);
			expect((await log.histories()).of(P, S)).toEqual(skipped);
		});

		test("the start of a run with the schedule as its trigger counts as fired", async () => {
			await under.runStarted({
				projectId: P,
				scheduleId: S,
				at: 100,
				runId: "cut-short",
			});
			expect((await log.histories()).of(P, S)).toEqual({
				lastAt: 100,
				last: { kind: "fired", at: 100, runId: "cut-short" },
				runIds: ["cut-short"],
			});
		});

		test("an older fact does not replace a newer last result", async () => {
			await log.fired({
				projectId: P,
				scheduleId: S,
				at: 200,
				runId: "run-2",
				error: null,
			});
			await log.skipped({
				projectId: P,
				scheduleId: S,
				at: 100,
				reason: "late",
				runId: null,
			});
			expect((await log.histories()).of(P, S)).toEqual({
				lastAt: 200,
				last: { kind: "fired", at: 200, runId: "run-2" },
				runIds: ["run-2"],
			});
		});

		test("keeps each schedule and each project apart", async () => {
			await log.fired({
				projectId: P,
				scheduleId: S,
				at: 100,
				runId: "run-1",
				error: null,
			});
			const histories = await log.histories();
			expect(histories.of(P, "other")).toBeUndefined();
			expect(histories.of(under.otherProjectId, S)).toBeUndefined();
		});

		test("a log that starts again reads the same histories", async () => {
			await under.runStarted({
				projectId: P,
				scheduleId: S,
				at: 100,
				runId: "run-1",
			});
			await log.fired({
				projectId: P,
				scheduleId: S,
				at: 100,
				runId: "run-1",
				error: null,
			});
			await log.skipped({
				projectId: P,
				scheduleId: S,
				at: 200,
				reason: "You paused this schedule for tonight.",
				runId: null,
			});
			const before = (await log.histories()).of(P, S);
			const again = under.open();
			expect((await again.histories()).of(P, S)).toEqual(before);
			expect(before).toEqual({
				lastAt: 200,
				last: {
					kind: "skipped",
					at: 200,
					reason: "You paused this schedule for tonight.",
					runId: null,
				},
				runIds: ["run-1"],
			});
		});

		test("reads the facts another log wrote since its last read", async () => {
			const other = under.open();
			await log.histories();
			await other.fired({
				projectId: P,
				scheduleId: S,
				at: 100,
				runId: "run-1",
				error: null,
			});
			expect((await log.histories()).of(P, S)?.lastAt).toBe(100);
		});

		test("lists the webhooks of one schedule, newest first, at most the limit", async () => {
			const received = (
				scheduleId: string,
				at: number,
				projectId = P,
			): Promise<void> =>
				log.received({
					projectId,
					scheduleId,
					at,
					result: "accepted",
					runId: null,
					woke: 0,
					error: null,
				});
			await received("review", 100);
			await received("other", 150);
			await received("review", 200);
			await received("review", 300, under.otherProjectId);
			await log.received({
				projectId: P,
				scheduleId: "review",
				at: 400,
				result: "filtered",
				runId: null,
				woke: 0,
				error: "The rule failed: boom",
			});
			await log.received({
				projectId: P,
				scheduleId: "review",
				at: 500,
				result: "accepted",
				runId: "run-9",
				woke: 2,
				error: null,
			});

			expect(await log.deliveries(P, "review", 10)).toEqual([
				{ at: 500, result: "accepted", reason: null, runId: "run-9", woke: 2 },
				{
					at: 400,
					result: "filtered",
					reason: "The rule failed: boom",
					runId: null,
					woke: 0,
				},
				{ at: 200, result: "accepted", reason: null, runId: null, woke: 0 },
				{ at: 100, result: "accepted", reason: null, runId: null, woke: 0 },
			]);
			expect(
				(await log.deliveries(P, "review", 2)).map((delivery) => delivery.at),
			).toEqual([500, 400]);
			// A webhook is no cron time: it is not in the histories.
			expect((await log.histories()).of(P, "review")).toBeUndefined();
		});
	});
}
