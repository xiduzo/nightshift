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
	pruneCheckpoints,
	type Runner,
} from "../graph";
import {
	type EngineEventType,
	groupByRun,
	type LoggedEvent,
	parseEventRow,
	type RunBus,
	type RunLog,
	type RunRow,
	runsArriving,
	spaceOfRun,
} from "../log";
import {
	awaitsWorktree,
	countDaemonResumes,
	deriveRunState,
	deriveStopAt,
	runWorktree,
} from "../read";
import type { StartHolds } from "./start-holds";

/**
 * Startup recovery: what a new daemon does about the runs the last one
 * left open. A daemon that died left sessions, steps and runs open. They
 * become `interrupted` as a stop ends them (`closeOpenWork`,
 * `graph/open-work.ts`), a run that ends so keeps only the checkpoints a
 * re-entry reads (a `prune` Turn of the runner; a sweep first prunes every
 * thread the same way), sleeping runs get their
 * timers back, and after a grace period the daemon resumes the interrupted
 * runs itself unless `daemonResumeBlock` says why not. A step past its
 * recorded time budget or idle limit ends as its timer would have ended it
 * instead (an `overdue` Turn of the runner).
 *
 * The daemon's resume is a Turn of the runner (`runner.take`): the slot,
 * the re-entry plan (`planReentry`), `RunResumed` before the thread moves
 * (design rule 9), and the drive. It waits in the runner's cap queue on a
 * full run cap. A person's resume, restart and run again are run actions
 * (`actions.ts`).
 */

const INTERRUPTED_REASON = "Night Shift stopped while this run ran.";
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
		// A run whose Device was offline at the start has no worktree yet: a step makes it.
		if (awaitsWorktree(row, events)) return null;
		const worktree = await stat(runWorktree(row, events).worktreePath).catch(
			() => null,
		);
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
	/** The daemon's resume makes a run active: it waits while the run's Space's Projects move. */
	holds: Pick<StartHolds, "start">;
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
		// Every thread keeps only what a resume reads. Cheap once clean.
		await pruneCheckpoints(db).catch((error) => {
			console.warn("[engine] could not prune the checkpoints", error);
		});
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
			// A run that ended so keeps only what a re-entry reads, as a
			// drive's end leaves it. A run whose flow cannot be read keeps
			// its history: recovery goes on with the next run.
			if (open.endsRun) {
				await runner.take(runId, { kind: "prune" }).catch((error) => {
					console.warn(`[engine] could not prune run ${runId}`, error);
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
	 * Resumes a run that startup recovery interrupted, in the same Turn as a
	 * person's resume. While the Projects of its Space move, it waits for
	 * the move, as a schedule that came due does. Checks again first: a
	 * person may have resumed it, or the stop time came meanwhile. A full
	 * run cap queues it: a freed slot asks again from the top.
	 */
	async function resumeAfterRestart(runId: string): Promise<void> {
		if (disposed) return;
		try {
			await recovered;
			const spaceId = await spaceOfRun(db, runId);
			if (spaceId === null) return;
			await deps.holds.start(
				spaceId,
				async () => {
					if (disposed) return;
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
				},
				"wait",
			);
		} catch (error) {
			console.error(`[engine] could not resume run ${runId}`, error);
		}
	}

	return { recoverInterruptedWork, armResumes };
}
