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
	planReentry,
	type ReentryRequest,
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
} from "../log";
import {
	countDaemonResumes,
	deriveRunState,
	deriveSteps,
	deriveStopAt,
} from "../read";

/**
 * Recovery: what a daemon does about runs that did not end on their own.
 * Two things live here because they share one rule (design rule 9: a resume
 * appends `RunResumed` before the thread moves) and the queue:
 *
 * - Startup recovery (`recoverInterruptedWork`): a daemon that died left
 *   sessions, steps and runs open. They become `interrupted` as a stop
 *   ends them (`closeOpenWork`, `graph/open-work.ts`), sleeping runs
 *   get their timers back, and after a grace period the daemon resumes the
 *   interrupted runs itself unless `daemonResumeBlock` says why not. A
 *   step past its recorded time budget or idle limit ends as its timer
 *   would have ended it instead (`runner.endIfOverdue`).
 * - Resume (`resume`, `restartStep`, `rerunFrom`): a person's resume and
 *   the daemon's both come here. The re-entry planner (`planReentry`,
 *   `graph/reentry.ts`) decides from the log and the thread's checkpoint
 *   what `RunResumed` records and how the thread moves; `reenter` appends
 *   the one and hands the other to the runner.
 *
 * The seam is `createRecovery(deps)`: the engine gives the database, the
 * run log, the runner, the clock and the settings, and gets back three
 * calls. The run cap queue (`pendingResumes`, `onSlotFreed`) is the
 * module's own state, so the engine no longer knows a queue exists.
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
	const { db, log, runner, now, settings } = deps;
	/** Interrupted runs the daemon resumes when a slot frees. */
	const pendingResumes = new Set<string>();
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
			pendingResumes.clear();
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
		// Only the runs this Device walks: a run walked elsewhere is its
		// Walker's to recover.
		const rows = await db
			.select()
			.from(event)
			.where(
				and(
					isNotNull(event.runId),
					eq(event.walkerId, await log.walkerId()),
					inArray(event.type, [...LIFECYCLE_EVENT_TYPES]),
				),
			)
			.orderBy(asc(event.seq));
		const byRun = groupByRun(rows.map(parseEventRow));
		toResume = [];
		for (const [runId, events] of byRun) {
			// The lifecycle events are enough to see what is open.
			const open = openWork(events, "interrupted");
			// A step that ran past its time budget or idle limit meanwhile
			// ends as its timer would have ended it, and the run fails: it
			// does not continue.
			if (
				open.endsRun &&
				open.steps.length > 0 &&
				(await runner.endIfOverdue(runId, 0))
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
			if (!open.endsRun) runner.sleeps.restore(runId, events);
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
	 * or the stop time came meanwhile. A full run cap queues it.
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
			await resume(runId, { by: "daemon" });
		} catch (error) {
			console.error(`[engine] could not resume run ${runId}`, error);
		}
	}

	/** The runner freed a slot: the queued daemon resumes try again. */
	function onSlotFreed(): void {
		if (disposed) return;
		for (const runId of [...pendingResumes]) {
			pendingResumes.delete(runId);
			void resumeAfterRestart(runId);
		}
	}

	/**
	 * Continues a stopped, failed or interrupted run, or wakes a sleeping
	 * one. A person's resume and the daemon's after a restart both come
	 * here; `RunResumed` says which, and is appended before the thread
	 * moves (design rule 9). The daemon's queues on a full run cap, like a
	 * wake. Where the thread continues comes from its checkpoint
	 * (`planReentry`): its interrupt is answered, its pending node runs
	 * again, or a thread that ended or never ran jumps to the top-level
	 * node the log points at.
	 */
	async function resume(
		runId: string,
		input: { by: ResumedBy; prompt?: string },
	): Promise<void> {
		const { prompt } = input;
		const row = await getRunRow(db, runId);
		if (row.walkerId !== (await log.walkerId())) {
			throw new Error(WALKED_ELSEWHERE);
		}
		const before = await log.events(runId);
		if (deriveRunState(before).status === "sleeping") {
			await runner.sleeps.wake(runId, {
				early: true,
				...(prompt !== undefined ? { prompt } : {}),
			});
			return;
		}
		if (
			input.by === "daemon" &&
			!runner.isActive(runId) &&
			runner.activeCount() >= settings().maxConcurrentRuns
		) {
			pendingResumes.add(runId);
			return;
		}
		runner.reserveSlot(runId);
		try {
			await reenter(row, { kind: "resume", ...input });
		} finally {
			runner.releaseStartingSlot(runId);
		}
	}

	/**
	 * A re-entry, on a run whose slot the caller holds: plans it from the
	 * log and the thread's latest checkpoint (`planReentry`, which refuses
	 * a run that runs, waits or sleeps), appends the plan's `RunResumed`,
	 * and moves the thread as the plan says (`runner.enter`).
	 */
	async function reenter(row: RunRow, request: ReentryRequest): Promise<void> {
		const runId = row.id;
		const plan = planReentry({
			flow: deps.flowOf(row),
			events: await log.events(runId),
			thread: await runner.threadSnapshot(row),
			request,
			now: now(),
		});
		await log.append({ type: "RunResumed", runId, payload: plan.resumed });
		try {
			await runner.enter(row, plan);
		} catch (error) {
			if (request.kind !== "rerun") throw error;
			// No drive took the run: end the walk `RunResumed` began.
			await log.append({
				type: "RunEnded",
				runId,
				payload: {
					status: "failed",
					reason: `The run could not start again: ${messageOf(error)}`,
				},
			});
			throw error;
		}
	}

	/**
	 * Stops the running step and continues it at once, as a stop now and a
	 * resume would, in one action (`runner.restart`): nothing comes in
	 * between, the old drive is fenced off and its harness aborted before
	 * the resume reads the log, and the run keeps its slot. The resume is
	 * Resume's (`reenter`), so the step continues as Resume continues it: an
	 * Agent step with a harness session reopens it with `prompt` (default
	 * "Continue where you left off."), any other step runs again.
	 *
	 * Refused unless a step runs: for a run another Device walks, a run that
	 * waits, sleeps or ended, and between steps. With `stepId`, also when
	 * that step is no longer open (it ended, and the run went on).
	 */
	async function restartStep(
		runId: string,
		input: { by: ResumedBy; prompt?: string; stepId?: string },
	): Promise<void> {
		const row = await getRunRow(db, runId);
		if (row.walkerId !== (await log.walkerId())) {
			throw new Error(RESTART_ELSEWHERE);
		}
		await runner.restart(
			runId,
			(events) => {
				const status = deriveRunState(events).status;
				if (status !== "running") throw new Error(NOT_RUNNING[status]);
				const open = deriveSteps(events).filter((s) => s.endedAt === null);
				if (open.length === 0) {
					throw new Error(
						"No step runs right now. Try again when the next step starts.",
					);
				}
				if (
					input.stepId !== undefined &&
					!open.some((s) => s.id === input.stepId)
				) {
					throw new Error(
						"That step has ended. Restart the step that runs now.",
					);
				}
			},
			() =>
				reenter(row, {
					kind: "resume",
					by: input.by,
					action: "restart",
					...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
				}),
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
		const row = await getRunRow(db, runId);
		if (row.walkerId !== (await log.walkerId())) {
			throw new Error(RERUN_ELSEWHERE);
		}
		// Before the slot: a node the flow does not have is refused first.
		const refusal = rerunNodeRefusal(deps.flowOf(row), input.nodeId);
		if (refusal) throw new Error(refusal);
		runner.reserveSlot(runId);
		try {
			await reenter(row, { kind: "rerun", ...input });
		} finally {
			runner.releaseStartingSlot(runId);
		}
	}

	return {
		recoverInterruptedWork,
		armResumes,
		resume,
		restartStep,
		rerunFrom,
		onSlotFreed,
	};
}
