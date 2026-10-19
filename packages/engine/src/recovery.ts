import { stat } from "node:fs/promises";
import type { Database } from "@nightshift/db";
import { event, run } from "@nightshift/db/schema/nightshift";
import type { Flow } from "@nightshift/flows";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";

import {
	countDaemonResumes,
	deriveRunState,
	deriveStopAt,
	type EngineEventType,
	groupByRun,
	type LoggedEvent,
	openWork,
	parseEventRow,
	type ResumedBy,
} from "./events";
import {
	DEFAULT_RESUME_PROMPT,
	getRunRow,
	messageOf,
	type RunRow,
} from "./graph/context";
import { resumeTarget } from "./graph/resume-point";
import type { Runner, ThreadState } from "./graph/runner";
import type { RunLog } from "./run-log";
import type { RunSettings } from "./settings";

/**
 * Recovery: what a daemon does about runs that did not end on their own.
 * Two things live here because they share one rule (design rule 9: a resume
 * appends `RunResumed` before the thread moves) and one mapping
 * (`resumeTarget`, `ThreadState`):
 *
 * - Startup recovery (`recoverInterruptedWork`): a daemon that died left
 *   sessions, steps and runs open. They become `interrupted`, sleeping runs
 *   get their timers back, and after a grace period the daemon resumes the
 *   interrupted runs itself unless `daemonResumeBlock` says why not.
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
		const toResume: string[] = [];
		for (const [runId, events] of byRun) {
			const open = openWork(events);
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
		if (toResume.length > 0 && !disposed) {
			resumeTimer = setTimeout(() => {
				for (const runId of toResume) void resumeAfterRestart(runId);
			}, deps.resumeGraceMs);
			resumeTimer.unref?.();
		}
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
			const events = await log.events(runId);
			const status = deriveRunState(events).status;
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
			const stopAt = deriveStopAt(events);
			// A resume past the stop time clears it: in the log, and in the
			// thread's state before the node continues.
			const clearStopAt = stopAt !== null && now() >= stopAt;
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
		} finally {
			runner.releaseStartingSlot(runId);
		}
	}

	return { recoverInterruptedWork, resume, onSlotFreed };
}
