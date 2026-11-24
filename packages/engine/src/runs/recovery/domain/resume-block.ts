import { Refusal } from "@nightshift/refusal";

/**
 * Why Night Shift does not continue a run on its own after a restart. A
 * daemon that died left the run interrupted mid-step. The new daemon
 * continues it, as a person would, unless one of these reasons holds. The
 * run's end reason then says why (`interruptedReason`).
 */

/** What the end of a run says when Night Shift stopped while it ran. */
export const INTERRUPTED_REASON = "Night Shift stopped while this run ran.";

/** Daemon resumes in a row (no person in between) before a run waits for a person. */
export const MAX_DAEMON_RESUMES = 3;

/** The switches of Settings the check reads. */
export type ResumeSettings = {
	scheduler: boolean;
	resumeInterruptedRuns: boolean;
};

/** The run's state, as the check reads it. */
export type ResumeState = {
	/** The resumes of the daemon in a row, with no person in between. */
	daemonResumes: number;
	stopAt: number | null;
	/** The run works in a run folder, not in a worktree (ADR 22). */
	runFolder: boolean;
};

/** What the run's record says. The check reads each fact when it comes to it. */
export type ResumeRecord = {
	/** The flow's own switch (`policy.resumeInterruptedRuns`), from its snapshot. Undefined: the flow has none. */
	ownResume(): boolean | undefined;
	/** The run's steps run on another Device. Its worktree is there, and that Device says when it is gone. */
	placedElsewhere(): boolean;
	/** The run's Device was offline at the start, so the run has no worktree yet. */
	awaitsWorktree(): boolean;
	/** Whether the folder of the run's worktree is there. */
	worktreeThere(): Promise<boolean>;
};

/** What `resumeBlock` asks, in the order it asks. */
export type ResumeFacts = {
	/** False on a daemon made with `scheduler: false`: a dev daemon. */
	schedulerOn: boolean;
	settings(): ResumeSettings;
	now(): number;
	run: ResumeState;
	/** The run's record, or null when it is missing. */
	record(): Promise<ResumeRecord | null>;
};

/**
 * Why the daemon must not resume a run it stopped mid-step, or null. Only
 * a daemon with the scheduler on resumes: a dev daemon on a copy of the
 * database never continues the night's runs on real repos. A fact that
 * throws is a reason too, not a crash.
 */
export async function resumeBlock(facts: ResumeFacts): Promise<string | null> {
	try {
		if (!facts.schedulerOn || !facts.settings().scheduler) {
			return "schedules are paused.";
		}
		const record = await facts.record();
		if (!record) return "the run's record is missing.";
		const own = record.ownResume();
		if (!(own ?? facts.settings().resumeInterruptedRuns)) {
			return own === false
				? "its flow turns automatic resume off."
				: "automatic resume is off in Settings.";
		}
		const resumes = facts.run.daemonResumes;
		if (resumes >= MAX_DAEMON_RESUMES) {
			return `it continued on its own ${resumes} times in a row, and each time Night Shift stopped again.`;
		}
		const { stopAt } = facts.run;
		if (stopAt !== null && facts.now() >= stopAt) {
			return "its stop time has passed.";
		}
		// A run placed on another Device has its worktree there: that Device
		// says when it is gone.
		if (record.placedElsewhere()) return null;
		// A run folder that is gone is made again, empty, by the next step
		// that works in it, and the run warns (ADR 22).
		if (facts.run.runFolder) return null;
		// A run whose Device was offline at the start has no worktree yet: a step makes it.
		if (record.awaitsWorktree()) return null;
		if (!(await record.worktreeThere())) {
			return "the copy of the project it worked in is gone.";
		}
		return null;
	} catch (error) {
		// The run's flow does not read: the refusal says it all.
		if (error instanceof Refusal) return error.message;
		return `Night Shift could not check it: ${error instanceof Error ? error.message : String(error)}`;
	}
}

/** The end reason of a run that Night Shift interrupted: with why it does not continue, when it does not. */
export function interruptedReason(why: string | null): string {
	return why
		? `${INTERRUPTED_REASON} It did not continue on its own: ${why}`
		: INTERRUPTED_REASON;
}
