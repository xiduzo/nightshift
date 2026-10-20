import { stat } from "node:fs/promises";
import type { Database } from "@nightshift/db";
import { event, run } from "@nightshift/db/schema";
import type { Flow } from "@nightshift/flows";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import type { RunSettings } from "../device-config";
import {
	DEFAULT_RESUME_PROMPT,
	latestStepOf,
	messageOf,
	type Runner,
	resumeTarget,
	sessionOf,
	type ThreadState,
} from "../graph";
import {
	type EngineEventType,
	getRunRow,
	groupByRun,
	type LoggedEvent,
	parseEventRow,
	type ResumedBy,
	type RunLog,
	type RunRow,
	type RunStatus,
} from "../log";
import {
	countDaemonResumes,
	deriveRunState,
	deriveSteps,
	deriveStopAt,
	openWork,
} from "../read";

/**
 * Recovery: what a daemon does about runs that did not end on their own.
 * Two things live here because they share one rule (design rule 9: a resume
 * appends `RunResumed` before the thread moves) and one mapping
 * (`resumeTarget`, `ThreadState`):
 *
 * - Startup recovery (`recoverInterruptedWork`): a daemon that died left
 *   sessions, steps and runs open. They become `interrupted`, sleeping runs
 *   get their timers back, and after a grace period the daemon resumes the
 *   interrupted runs itself unless `daemonResumeBlock` says why not. A
 *   step past its recorded time budget or idle limit ends as its timer
 *   would have ended it instead (`runner.endIfOverdue`).
 * - Resume (`resume`): a person's resume and the daemon's both come here,
 *   and the thread's checkpoint decides how the run continues.
 *
 * The seam is `createRecovery(deps)`: the engine gives the database, the
 * run log, the runner, the clock and the settings, and gets back three
 * calls. The run cap queue (`pendingResumes`, `onSlotFreed`) is the
 * module's own state, so the engine no longer knows a queue exists.
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
const DAEMON_RESUME_REASON = "Night Shift restarted.";
/** The follow-up prompt of an Agent session that the daemon continues after a restart. */
const DAEMON_RESUME_PROMPT =
	"Night Shift stopped while you worked on this, so your last actions may or may not have happened. Before you repeat any of them, check the worktree (git status, git log) and the remote (pushed branches, pull requests, comments). Then continue where you left off.";

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
		const error = "Night Shift stopped while this ran.";
		toResume = [];
		for (const [runId, events] of byRun) {
			const open = openWork(events);
			// A step that ran past its time budget or idle limit meanwhile
			// ends as its timer would have ended it, and the run fails: it
			// does not continue.
			if (
				open.runOpen &&
				open.steps.length > 0 &&
				(await runner.endIfOverdue(runId, 0))
			) {
				continue;
			}
			for (const session of open.sessions) {
				await log.append({
					type: "SessionEnded",
					runId,
					stepId: session.stepId,
					sessionId: session.id,
					payload: {
						outcome: "interrupted",
						error,
						errorKind: null,
						usage: null,
						costUsd: null,
						resetAt: null,
					},
				});
			}
			for (const open_ of open.steps) {
				await log.append({
					type: "StepEnded",
					runId,
					stepId: open_.id,
					payload: {
						outcome: "interrupted",
						outputs: { ...open_.outputs, outcome: "interrupted" },
						error,
					},
				});
			}
			if (open.runOpen) {
				const why = await daemonResumeBlock(runId, events, deps);
				await log.append({
					type: "RunEnded",
					runId,
					payload: {
						status: "interrupted",
						reason: why
							? `${INTERRUPTED_REASON} It did not continue on its own: ${why}`
							: INTERRUPTED_REASON,
					},
				});
				if (!why) toResume.push(runId);
			}
			// A sleeping run gets its timer back from the log (`deriveSleep`).
			if (!open.runOpen) runner.sleeps.restore(runId, events);
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
	 * wake. Where the thread continues comes from its checkpoint:
	 *
	 * - at a wait or a parked step → `Command({ resume: { kind: "resume", prompt } })`;
	 * - at a Gate (the run was stopped there) → `{ kind: "reopen" }`;
	 * - a node pending without an interrupt (the daemon died, or the engine
	 *   failed, while it ran) → `invoke(null)` re-runs that node;
	 * - a thread that ended or never ran (a run from before this engine, or
	 *   a finished one whose checkpoints the runner deleted) → jump to the
	 *   top-level node the log points at, with the state seeded from the log.
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
			await continueThread(row, input);
		} finally {
			runner.releaseStartingSlot(runId);
		}
	}

	/**
	 * The resume itself, on a run whose slot the caller holds: refuses a run
	 * that runs, waits or sleeps, appends `RunResumed`, and moves the thread
	 * by its checkpoint (see `resume`).
	 */
	async function continueThread(
		row: RunRow,
		input: { by: ResumedBy; prompt?: string; action?: "restart" },
	): Promise<void> {
		const { prompt } = input;
		const runId = row.id;
		const events = await log.events(runId);
		refuseLive(deriveRunState(events).status);
		const flow = deps.flowOf(row);
		const target = resumeTarget(events) ?? {
			nodeId: flow.start,
			stepId: null,
			scope: null,
			topNodeId: flow.start,
		};
		const thread: ThreadState = await runner.threadState(row);
		const resumedPrompt =
			prompt ??
			(input.by === "daemon" ? DAEMON_RESUME_PROMPT : DEFAULT_RESUME_PROMPT);
		const clearStopAt = stopTimePassed(events);
		await log.append({
			type: "RunResumed",
			runId,
			payload: {
				nodeId: target.nodeId,
				stepId: target.stepId,
				prompt: target.stepId ? resumedPrompt : null,
				scope: target.scope,
				...(clearStopAt ? { clearStopAt: true } : {}),
				by: input.by,
				...(input.by === "daemon" ? { reason: DAEMON_RESUME_REASON } : {}),
				...(input.action ? { action: input.action } : {}),
			},
		});
		const update = clearStopAt ? { stopAt: null } : undefined;
		switch (thread.kind) {
			case "interrupted":
				runner.resume(
					row,
					thread.value.kind === "gate"
						? { kind: "reopen" }
						: { kind: "resume", prompt: resumedPrompt },
					update,
				);
				break;
			case "pending":
				runner.continueRun(row, update);
				break;
			case "ended":
			case "fresh":
				await runner.reenter(row, target.topNodeId, events, update);
				break;
		}
	}

	/** Throws for a run that is still going: it must stop first. */
	function refuseLive(status: RunStatus): void {
		if (status === "running") {
			throw new Error(
				"This run is still running. Stop it or wait for it to end.",
			);
		}
		if (status === "waiting") {
			throw new Error(
				"This run waits at a Gate. Answer the Gate, or stop the run first.",
			);
		}
		if (status === "sleeping") {
			throw new Error(
				"This run sleeps until a wait ends. Resume it again to wake it now.",
			);
		}
	}

	/**
	 * A resume past the stop time clears it: in the log, and in the
	 * thread's state before the node continues.
	 */
	function stopTimePassed(events: readonly LoggedEvent[]): boolean {
		const stopAt = deriveStopAt(events);
		return stopAt !== null && now() >= stopAt;
	}

	/**
	 * Stops the running step and continues it at once, as a stop now and a
	 * resume would, in one action (`runner.restart`): nothing comes in
	 * between, the old drive is fenced off and its harness aborted before
	 * the resume reads the log, and the run keeps its slot. The resume is
	 * `continueThread`'s, so the step continues as Resume continues it: an
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
				continueThread(row, {
					by: input.by,
					action: "restart",
					...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
				}),
		);
	}

	/**
	 * Walks a run that ended again from `nodeId`, a node of its own flow
	 * (not of a flow a Call node calls), with a new visit of it
	 * (`runner.rerun`). The steps after it run again as the flow routes;
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
		const flow = deps.flowOf(row);
		if (!flow.nodes.some((n) => n.id === input.nodeId)) {
			throw new Error(
				`This run's flow has no node "${input.nodeId}". Pick a step of the run's own flow, not one inside a called flow.`,
			);
		}
		runner.reserveSlot(runId);
		try {
			const events = await log.events(runId);
			refuseLive(deriveRunState(events).status);
			const last =
				input.stepId === undefined
					? latestStepOf({ id: input.nodeId }, events, null)
					: deriveSteps(events).find((s) => s.id === input.stepId);
			if (
				input.stepId !== undefined &&
				(last?.nodeId !== input.nodeId || last.scope !== null)
			) {
				throw new Error(
					`That step is not a step of "${input.nodeId}" in the run's own flow.`,
				);
			}
			const continued =
				!input.fresh && last?.nodeType === "agent" && sessionOf(last) !== null
					? last
					: null;
			const clearStopAt = stopTimePassed(events);
			await log.append({
				type: "RunResumed",
				runId,
				payload: {
					nodeId: input.nodeId,
					stepId: continued?.id ?? null,
					prompt: continued ? (input.prompt ?? DEFAULT_RESUME_PROMPT) : null,
					scope: null,
					...(clearStopAt ? { clearStopAt: true } : {}),
					by: input.by,
					action: "rerun",
				},
			});
			try {
				await runner.rerun(
					row,
					input.nodeId,
					events,
					clearStopAt ? { stopAt: null } : undefined,
				);
			} catch (error) {
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
