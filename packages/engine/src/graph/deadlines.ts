import { lastEntryAt, type RunState, transcriptToRead } from "../log";
import { deriveStepClocks } from "../read";
import { budgetError } from "./step-runner";

/**
 * Deadlines that hold when the timers do not. A step's time budget and
 * idle limit run as timers in the process that runs the step
 * (`beginStep`): the fast path. A process whose timers stop firing, or
 * that dies, takes them along. The log keeps the same limits
 * (`StepBudget`), so the runner can check a running step against them at
 * any time (`findOverdue`): the daemon's periodic sweep, and startup
 * recovery for a step the dead daemon left open.
 *
 * The idle clock needs the step's last activity. Every harness event
 * resets the idle timer and is a transcript entry with its time, so the
 * last entry of the step's transcript is its last activity. That file is
 * on disk already and survives a restart; a log event per activity would
 * add a database write per harness event for this check alone.
 */

/** A running step that ran past a limit, and how it ends. */
export type Overdue = {
	stepId: string;
	nodeId: string;
	reason: "timeout" | "idle";
	/** The step's error, as its timer gives it. */
	error: string;
};

/**
 * The running step of the run that ran past its time budget or its idle
 * limit by at least `graceMs`, or null. When several did, the one whose
 * limit passed first.
 */
export async function findOverdue(
	run: RunState,
	clock: { now: number; graceMs: number; minuteMs: number },
	/** The run, and this computer's data folder: where its transcripts are. */
	of: { runId: string; dataDir: string },
): Promise<Overdue | null> {
	let found: { at: number; overdue: Overdue } | null = null;
	for (const { step, timeoutMs, idleMs, since } of deriveStepClocks(run)) {
		const limits: {
			reason: Overdue["reason"];
			ms: number;
			at: number;
		}[] = [];
		if (timeoutMs !== null) {
			limits.push({ reason: "timeout", ms: timeoutMs, at: since + timeoutMs });
		}
		if (idleMs !== null && clock.now >= since + idleMs + clock.graceMs) {
			const active = Math.max(
				since,
				(await lastEntryAt(
					transcriptToRead(of.dataDir, of.runId, step.id, step.transcriptPath),
				)) ?? since,
			);
			limits.push({ reason: "idle", ms: idleMs, at: active + idleMs });
		}
		for (const { reason, ms, at } of limits) {
			if (clock.now < at + clock.graceMs) continue;
			if (found && found.at <= at) continue;
			found = {
				at,
				overdue: {
					stepId: step.id,
					nodeId: step.nodeId,
					reason,
					error: budgetError(reason, Math.round(ms / clock.minuteMs)),
				},
			};
		}
	}
	return found?.overdue ?? null;
}
