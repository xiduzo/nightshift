import { describe, expect, test } from "bun:test";
import {
	INTERRUPTED_REASON,
	interruptedReason,
	MAX_DAEMON_RESUMES,
	type ResumeFacts,
	type ResumeRecord,
	resumeBlock,
} from "./resume-block";

/**
 * `resumeBlock`: why a daemon leaves an interrupted run to a person. The
 * run's record and the folder of its worktree are facts here. How the
 * facts come from the run's row and its log is `check-resume.test.ts`.
 */

/** A record with nothing in the way: the flow has no switch, the worktree is there on this computer. */
function record(overrides: Partial<ResumeRecord> = {}): ResumeRecord {
	return {
		ownResume: () => undefined,
		placedElsewhere: () => false,
		awaitsWorktree: () => false,
		worktreeThere: async () => true,
		...overrides,
	};
}

/** The facts of a run that started at 1 000 ms, with no stop time, read at 10 000 ms. */
function facts(
	overrides: Partial<Omit<ResumeFacts, "run" | "record">> & {
		run?: Partial<ResumeFacts["run"]>;
		record?: ResumeRecord | null;
	} = {},
): ResumeFacts {
	const { run, record: given, ...rest } = overrides;
	const theRecord = given === undefined ? record() : given;
	return {
		schedulerOn: true,
		settings: () => ({ scheduler: true, resumeInterruptedRuns: true }),
		now: () => 10_000,
		run: { daemonResumes: 0, stopAt: null, runFolder: false, ...run },
		record: async () => theRecord,
		...rest,
	};
}

describe("resumeBlock", () => {
	test("lets a run continue when nothing stands in the way", async () => {
		expect(await resumeBlock(facts())).toBeNull();
	});

	test("a daemon without the scheduler never continues the night's runs", async () => {
		expect(await resumeBlock(facts({ schedulerOn: false }))).toBe(
			"schedules are paused.",
		);
		expect(
			await resumeBlock(
				facts({
					settings: () => ({ scheduler: false, resumeInterruptedRuns: true }),
				}),
			),
		).toBe("schedules are paused.");
	});

	test("a missing run record", async () => {
		expect(await resumeBlock(facts({ record: null }))).toBe(
			"the run's record is missing.",
		);
	});

	test("the flow's own policy wins over the Settings switch", async () => {
		expect(
			await resumeBlock(facts({ record: record({ ownResume: () => false }) })),
		).toBe("its flow turns automatic resume off.");
		const off = () => ({ scheduler: true, resumeInterruptedRuns: false });
		expect(
			await resumeBlock(
				facts({ settings: off, record: record({ ownResume: () => true }) }),
			),
		).toBeNull();
	});

	test("automatic resume off in Settings", async () => {
		expect(
			await resumeBlock(
				facts({
					settings: () => ({ scheduler: true, resumeInterruptedRuns: false }),
				}),
			),
		).toBe("automatic resume is off in Settings.");
	});

	test("three daemon resumes in a row, with no person in between", async () => {
		expect(
			await resumeBlock(facts({ run: { daemonResumes: MAX_DAEMON_RESUMES } })),
		).toBe(
			"it continued on its own 3 times in a row, and each time Night Shift stopped again.",
		);
		// A person's resume starts the count over: the fold says so.
		expect(await resumeBlock(facts({ run: { daemonResumes: 1 } }))).toBeNull();
	});

	test("a stop time that has passed", async () => {
		expect(await resumeBlock(facts({ run: { stopAt: 9_000 } }))).toBe(
			"its stop time has passed.",
		);
		expect(await resumeBlock(facts({ run: { stopAt: 11_000 } }))).toBeNull();
	});

	test("a worktree that is gone", async () => {
		expect(
			await resumeBlock(
				facts({ record: record({ worktreeThere: async () => false }) }),
			),
		).toBe("the copy of the project it worked in is gone.");
	});

	test("a run that waits for its worktree has none to lose", async () => {
		expect(
			await resumeBlock(
				facts({
					record: record({
						awaitsWorktree: () => true,
						worktreeThere: async () => false,
					}),
				}),
			),
		).toBeNull();
	});

	test("a run placed on another Device: that Device says when its worktree is gone", async () => {
		expect(
			await resumeBlock(
				facts({
					record: record({
						placedElsewhere: () => true,
						worktreeThere: async () => false,
					}),
				}),
			),
		).toBeNull();
	});

	test("a run folder that is gone does not stop it: its next step makes it again (ADR 22)", async () => {
		expect(
			await resumeBlock(
				facts({
					run: { runFolder: true },
					record: record({ worktreeThere: async () => false }),
				}),
			),
		).toBeNull();
	});

	test("a check that throws is a reason, not a crash", async () => {
		expect(
			await resumeBlock(
				facts({
					record: record({
						ownResume: () => {
							throw new Error("bad snapshot");
						},
					}),
				}),
			),
		).toBe("Night Shift could not check it: bad snapshot");
	});

	test("it reads no fact it does not need: a paused scheduler reads no record", async () => {
		let read = false;
		const reason = await resumeBlock({
			...facts({ schedulerOn: false }),
			record: async () => {
				read = true;
				return record();
			},
		});
		expect(reason).toBe("schedules are paused.");
		expect(read).toBe(false);
	});
});

describe("interruptedReason", () => {
	test("a run that continues says only that Night Shift stopped", () => {
		expect(interruptedReason(null)).toBe(INTERRUPTED_REASON);
		expect(INTERRUPTED_REASON).toBe("Night Shift stopped while this run ran.");
	});

	test("a run that does not continue says why", () => {
		expect(interruptedReason("schedules are paused.")).toBe(
			"Night Shift stopped while this run ran. It did not continue on its own: schedules are paused.",
		);
	});
});
