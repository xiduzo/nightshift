import { stat } from "node:fs/promises";
import type { Database } from "@nightshift/db";
import { event, run } from "@nightshift/db/schema";
import type { Flow } from "@nightshift/flows";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import type { RunSettings } from "../device-config";
import {
	closeOpenWork,
	messageOf,
	openWork,
	type Runner,
	rerunNodeRefusal,
} from "../graph";
import {
	type EngineEventType,
	getRunRow,
	groupByRun,
	type LoggedEvent,
	parseEventRow,
	type ResumedBy,
	type RunBus,
	type RunLog,
	type RunRow,
	type RunStatus,
	runsArriving,
} from "../log";
import {
	countDaemonResumes,
	deriveRunState,
	deriveSteps,
	deriveStopAt,
} from "../read";

/**
 * Recovery: what a daemon does about runs that did not end on their own.
 *
 * - Startup recovery (`recoverInterruptedWork`): a daemon that died left
 *   sessions, steps and runs open. They become `interrupted` as a stop
 *   ends them (`closeOpenWork`, `graph/open-work.ts`), sleeping runs
 *   get their timers back, and after a grace period the daemon resumes the
 *   interrupted runs itself unless `daemonResumeBlock` says why not. A
 *   step past its recorded time budget or idle limit ends as its timer
 *   would have ended it instead (an `overdue` Turn of the runner).
 * - Resume (`resume`, `restartStep`, `rerunFrom`): a person's resume and
 *   the daemon's both come here for their refusals: a run another Device
 *   walks, a step that does not run. The rest is a Turn of the runner
 *   (`runner.take`): the slot, the re-entry plan (`planReentry`),
 *   `RunResumed` before the thread moves (design rule 9), and the drive.
 *   The daemon's resume waits in the runner's cap queue on a full run cap.
 *
 */

const INTERRUPTED_REASON = "Night Shift stopped while this run ran.";
/** A person asked to resume a run another Device walks. */
export const WALKED_ELSEWHERE =
	"Another device runs this run. Resume it on that device.";
/** A person asked to restart a step of a run another Device walks. */
export const RESTART_ELSEWHERE =
	"Another device runs this run. Restart the step on that device.";
/** A person asked to run a run another Device walks again. */
export const RERUN_ELSEWHERE =
	"Another device runs this run. Run it again on that device.";
/** Why a run that runs no step has no step to restart. */
const NOT_RUNNING: Record<Exclude<RunStatus, "running">, string> = {
	waiting:
		"This run waits at a Gate. Answer the Gate, or stop the run and resume it.",
	sleeping: "This run sleeps. Wake it to continue now.",
	finished: "This run has ended. Run it again from a step instead.",
	failed: "This run has ended. Resume it, or run it again from a step.",
	stopped: "This run has ended. Resume it, or run it again from a step.",
	interrupted: "This run has ended. Resume it, or run it again from a step.",
};
/**
 * Throws why a restart is refused, from the run's log: the run runs no
 * step, or `stepId` is not the step that runs.
 */
function refuseRestart(
	events: readonly LoggedEvent[],
	stepId: string | undefined,
): void {
	const status = deriveRunState(events).status;
	if (status !== "running") throw new Error(NOT_RUNNING[status]);
	const open = deriveSteps(events).filter((s) => s.endedAt === null);
	if (open.length === 0) {
		throw new Error(
			"No step runs right now. Try again when the next step starts.",
		);
	}
	if (stepId !== undefined && !open.some((s) => s.id === stepId)) {
		throw new Error("That step has ended. Restart the step that runs now.");
	}
}

/** Daemon resumes in a row (no person in between) before a run waits for a person. */
const MAX_DAEMON_RESUMES = 3;
/** Event types that open or close work. Startup recovery reads only these. */
const LIFECYCLE_EVENT_TYPES = [
	"RunStarted",
	"RunResumed",
	"RunEnded",
	"StepStarted",
	"StepReopened",
	"StepEnded",
	"SessionStarted",
	"SessionEnded",
	"GateOpened",
	"WaitStarted",
	"WaitEnded",
] as const satisfies readonly EngineEventType[];

/** What `daemonResumeBlock` asks about the daemon and the run. */
export type ResumeBlockDeps = {
	db: Database;
	now(): number;
	settings(): RunSettings;
	/** False when the engine was made with `scheduler: false`: a dev daemon. */
	schedulerOn: boolean;
	/** The run's flow, from its snapshot. */
	flowOf(row: RunRow): Flow;
	/**
	 * Whether the run's steps run on another Device (its worktree is
	 * there). Without it: every run's are on this computer.
	 */
	placedElsewhere?(row: RunRow): boolean;
};

/**
 * Why the daemon must not resume a run it stopped mid-step, or null. Only
 * a daemon with the scheduler on resumes: a dev daemon on a copy of the
 * database never continues the night's runs on real repos.
 */
export async function daemonResumeBlock(
	runId: string,
	events: readonly LoggedEvent[],
	deps: ResumeBlockDeps,
): Promise<string | null> {
	try {
		if (!deps.schedulerOn || !deps.settings().scheduler) {
			return "schedules are paused.";
		}
		const [row] = await deps.db.select().from(run).where(eq(run.id, runId));
		if (!row) return "the run's record is missing.";
		const own = deps.flowOf(row).policy?.resumeInterruptedRuns;
		if (!(own ?? deps.settings().resumeInterruptedRuns)) {
			return own === false
				? "its flow turns automatic resume off."
				: "automatic resume is off in Settings.";
		}
		const resumes = countDaemonResumes(events);
		if (resumes >= MAX_DAEMON_RESUMES) {
			return `it continued on its own ${resumes} times in a row, and each time Night Shift stopped again.`;
		}
		const stopAt = deriveStopAt(events);
		if (stopAt !== null && deps.now() >= stopAt) {
			return "its stop time has passed.";
		}
		// A run placed on another Device has its worktree there: that Device
		// says when it is gone.
		if (deps.placedElsewhere?.(row)) return null;
		const worktree = await stat(row.worktreePath).catch(() => null);
		if (!worktree?.isDirectory()) {
			return "the copy of the project it worked in is gone.";
		}
		return null;
	} catch (error) {
		return `Night Shift could not check it: ${messageOf(error)}`;
	}
}

export type RecoveryDeps = ResumeBlockDeps & {
	log: RunLog;
	/** Told of the steps and runs recovery ends. */
	bus: RunBus;
	/** The flows the run's Call nodes call, from its snapshot. */
	calledFlowsOf(row: RunRow): Record<string, Flow>;
	runner: Runner;
	/** How long after its start the daemon resumes the runs recovery interrupted. */
	resumeGraceMs: number;
	/** Aborting it drops the queued resumes and the grace timer: the daemon dies. */
	signal?: AbortSignal;
};

export type Recovery = ReturnType<typeof createRecovery>;

export function createRecovery(deps: RecoveryDeps) {
	const { db, log, runner } = deps;
	let resumeTimer: ReturnType<typeof setTimeout> | undefined;
	/** The runs startup recovery interrupted, to resume once the engine is ready. */
	let toResume: string[] = [];
	let disposed = false;
	/** Startup recovery's promise; a daemon resume waits for it first. */
	let recovered: Promise<void> = Promise.resolve();
	deps.signal?.addEventListener(
		"abort",
		() => {
			disposed = true;
			clearTimeout(resumeTimer);
		},
		{ once: true },
	);

	/**
	 * A daemon that died left sessions, steps and runs open. They become
	 * `interrupted`. A moment later the daemon resumes those runs itself, as
	 * a person would, unless `daemonResumeBlock` says why not; the run's end
	 * reason says it. Open Gates and sleeping steps are facts, not lost work:
	 * a sleeping run gets its timer back (a wake time in the past fires at
	 * once).
	 */
	function recoverInterruptedWork(): Promise<void> {
		recovered = recover();
		return recovered;
	}

	async function recover(): Promise<void> {
		// Only the runs this Device walks, as their rows say: a run walked
		// elsewhere is its Walker's to recover. A run moved here has the
		// events of its old Walker too, and a run moved away is not ours.
		const self = await log.walkerId();
		const walkedHere = db
			.select({ id: run.id })
			.from(run)
			.where(eq(run.walkerId, self));
		const rows = await db
			.select()
			.from(event)
			.where(
				and(
					isNotNull(event.runId),
					inArray(event.runId, walkedHere),
					inArray(event.type, [...LIFECYCLE_EVENT_TYPES]),
				),
			)
			.orderBy(asc(event.seq));
		// A run that moved here and has not arrived: its take-over gives it
		// its walk state and its timer, once the engine is ready.
		const arriving = new Set(await runsArriving(db, [self]));
		const byRun = groupByRun(rows.map(parseEventRow));
		toResume = [];
		for (const [runId, events] of byRun) {
			if (arriving.has(runId)) continue;
			// The lifecycle events are enough to see what is open.
			const open = openWork(events, "interrupted");
			// A step that ran past its time budget or idle limit meanwhile
			// ends as its timer would have ended it, and the run fails: it
			// does not continue.
			if (
				open.endsRun &&
				open.steps.length > 0 &&
				(await runner.take(runId, { kind: "overdue", graceMs: 0 })).kind ===
					"halted"
			) {
				continue;
			}
			const why = open.endsRun
				? await daemonResumeBlock(runId, events, deps)
				: null;
			if (open.endsRun || open.steps.length > 0 || open.sessions.length > 0) {
				// The open work ends as a stop ends it (`closeOpenWork`), from
				// the run's whole log: a Call with `each` counts its items.
				await closeOpenWork(deps, runId, {
					kind: "interrupted",
					reason: why
						? `${INTERRUPTED_REASON} It did not continue on its own: ${why}`
						: INTERRUPTED_REASON,
				});
			}
			if (open.endsRun && !why) toResume.push(runId);
			// A sleeping run gets its timer back from the log (`deriveSleep`).
			if (!open.endsRun) runner.restore(runId, events);
		}
	}

	/**
	 * Starts the grace before the interrupted runs continue on their own.
	 * The engine calls it once it is ready, so the grace counts from then,
	 * however long its start took.
	 */
	function armResumes(): void {
		const runs = toResume;
		toResume = [];
		if (runs.length === 0 || disposed) return;
		resumeTimer = setTimeout(() => {
			for (const runId of runs) void resumeAfterRestart(runId);
		}, deps.resumeGraceMs);
		resumeTimer.unref?.();
	}

	/**
	 * Resumes a run that startup recovery interrupted, through the same path
	 * as a person's resume. Checks again first: a person may have resumed it,
	 * or the stop time came meanwhile. A full run cap queues it: a freed
	 * slot asks again from the top.
	 */
	async function resumeAfterRestart(runId: string): Promise<void> {
		if (disposed) return;
		try {
			await recovered;
			const events = await log.events(runId);
			if (
				runner.isActive(runId) ||
				deriveRunState(events).status !== "interrupted"
			) {
				return;
			}
			const why = await daemonResumeBlock(runId, events, deps);
			if (why) {
				console.warn(
					`[engine] run ${runId} did not continue on its own: ${why}`,
				);
				return;
			}
			await runner.take(
				runId,
				{ kind: "resume", by: "daemon" },
				{ whenFull: "queue", retry: () => void resumeAfterRestart(runId) },
			);
		} catch (error) {
			console.error(`[engine] could not resume run ${runId}`, error);
		}
	}

	/**
	 * Continues a stopped, failed or interrupted run, or wakes a sleeping
	 * one, as a person asks. `RunResumed` says who, and is appended before
	 * the thread moves (design rule 9). Where the thread continues comes
	 * from its checkpoint (`planReentry`): its interrupt is answered, its
	 * pending node runs again, or a thread that ended or never ran jumps to
	 * the top-level node the log points at.
	 */
	async function resume(
		runId: string,
		input: { by: ResumedBy; prompt?: string },
	): Promise<void> {
		await refuseElsewhere(runId, WALKED_ELSEWHERE);
		await runner.take(runId, { kind: "resume", ...input });
	}

	/** Throws `message` for a run another Device walks. */
	async function refuseElsewhere(runId: string, message: string) {
		const row = await getRunRow(db, runId);
		if (row.walkerId !== (await log.walkerId())) throw new Error(message);
		return row;
	}

	/**
	 * Stops the running step and continues it at once, as a stop now and a
	 * resume would, in one Turn of the runner: nothing comes in between,
	 * the old drive is fenced off and its harness aborted before the resume
	 * reads the log, and the run keeps its slot. The step continues as
	 * Resume continues it: an Agent step with a harness session reopens it
	 * with `prompt` (default "Continue where you left off."), any other step
	 * runs again.
	 *
	 * Refused unless a step runs: for a run another Device walks, a run that
	 * waits, sleeps or ended, and between steps. With `stepId`, also when
	 * that step is no longer open (it ended, and the run went on).
	 */
	async function restartStep(
		runId: string,
		input: { by: ResumedBy; prompt?: string; stepId?: string },
	): Promise<void> {
		await refuseElsewhere(runId, RESTART_ELSEWHERE);
		const { stepId, ...restart } = input;
		await runner.take(
			runId,
			{ kind: "restart", ...restart },
			{ check: (events) => refuseRestart(events, stepId) },
		);
	}

	/**
	 * Walks a run that ended again from `nodeId`, a node of its own flow
	 * (not of a flow a Call node calls), with a new visit of it
	 * (`planReentry`). The steps after it run again as the flow routes;
	 * inputs, node outputs and edge counts carry over.
	 *
	 * An Agent node continues the harness session of its step `stepId`
	 * (default: its latest top-level step) with `prompt` (default "Continue
	 * where you left off."), unless `fresh`: then it starts a new session
	 * with the node's own prompt. The new visit finds which in `RunResumed`
	 * (`rerunEntryOf`). Any other node runs as
	 * the flow says.
	 *
	 * Refused for a run another Device walks, a run that runs, waits or
	 * sleeps, and a node the run's flow does not have at the top level.
	 */
	async function rerunFrom(
		runId: string,
		input: {
			by: ResumedBy;
			nodeId: string;
			stepId?: string;
			prompt?: string;
			fresh?: boolean;
		},
	): Promise<void> {
		const row = await refuseElsewhere(runId, RERUN_ELSEWHERE);
		// Before the slot: a node the flow does not have is refused first.
		const refusal = rerunNodeRefusal(deps.flowOf(row), input.nodeId);
		if (refusal) throw new Error(refusal);
		await runner.take(runId, { kind: "rerun", ...input });
	}

	return {
		recoverInterruptedWork,
		armResumes,
		resume,
		restartStep,
		rerunFrom,
	};
}
