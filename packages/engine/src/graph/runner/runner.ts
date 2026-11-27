import { Refusal, wordsFor } from "@nightshift/refusal";
import { type RunState, runsArriving } from "../../log";
import { ANSWER_DROPPED } from "../../read";
import { ARRIVING, RunRefusal, WALKED_ELSEWHERE } from "../../run-status";
import { CONTINUED } from "./answer-plan";
import { createDrives } from "./drive";
import { NO_HOLDS } from "./holds";
import type { CloseDeps } from "./open-work";
import { createRunnerState, createTurnQueue } from "./run-slots";
import { openThread } from "./thread";
import type { Held, Intent, RunnerDeps, Taken, TakeOptions } from "./turn";
import { createTurns } from "./turns";
import { createSleeps } from "./wake";

/**
 * The per-run driver: every run is one LangGraph thread (thread id = run
 * id) on a graph compiled from the run's flow snapshot (design rule 1),
 * opened and streamed by the Thread module (`thread.ts`). The runner owns
 * what the walk owned around the steps: the slots and the run cap, the
 * per-run queue, the drive, and how a drive ended (`RunEnded`).
 *
 * Its interface is one entry: `take(runId, intent)`. Every action on a Run
 * this computer walks is a Turn (docs/glossary.md): start it, answer its
 * Gate, wake it, resume it, restart its step, run it again, stop it, or end
 * a step past its time. `hold(runId, fn)` is a Turn that drives nothing (a
 * stop after the step, a move). The caller says what it wants; the runner
 * knows the order: the queue, the run cap, the slot, `RunResumed` or
 * `WaitEnded`, then the drive.
 *
 * - A drive that parks at the root's interrupt: a `wait` schedules the
 *   wake timer (`WaitStarted` is in the log already); a `gate` needs
 *   nothing (the Gate node logged `GateOpened`); `parked` appends
 *   `RunEnded` with its status and reason (`endingOf`).
 * - A stream that ends with `state.ended` set appends `RunEnded finished`;
 *   one that throws appends `RunEnded failed` with `The engine failed: …`.
 * - A stop waits for nothing: it fences the drive off (`fence.ts`) and
 *   ends the run's open work itself (`closeOpenWork`, `open-work.ts`). A
 *   step past the time limits its log records ends the same way
 *   (`overdue`, `deadlines.ts`), from the runner's own sweep.
 * - The saver keeps the latest checkpoint of each namespace only
 *   (`checkpointer.ts`). A run that ended (finished, failed, stopped),
 *   waits or holds a Gate also drops the namespaces of its done tasks
 *   (`Thread.prune`): the log is the record. One that a dead daemon left
 *   is pruned by startup recovery (`prune`).
 * - How a sleep ends is the sleep module's (`planWake`, `recordWake`,
 *   `graph/runner/wake.ts`); how a re-entry moves the thread is the planner's
 *   (`planReentry`, `graph/runner/reentry.ts`).
 *
 * Invariants (each has a test in `runner.test.ts`):
 *
 * - I1 One Turn at a time per run: `take` and `hold` share one FIFO queue
 *   per run id. Every change to a run's slot, drive and open work happens
 *   in a Turn. The one writer outside a Turn is the drive itself, through
 *   its fence; when it ends it frees its slot only while the slot is still
 *   its own.
 * - I2 The run cap check and the reservation are one synchronous step, so
 *   two Turns cannot both pass a full cap.
 * - I3 A "starting" slot lives only inside the Turn that reserved it.
 *   Every other Turn of the run waits behind it, so none sees it. Only
 *   `isActive` and the cap count do.
 * - I4 A drive begins only inside a Turn that holds a "starting" slot of
 *   its run, and takes the slot over.
 * - I5 `RunResumed` and `WaitEnded` are appended in the Turn, after the
 *   slot is reserved and before the drive begins (design rule 9). A full
 *   cap never leaves one of them without a drive.
 * - I6 A Turn that takes a running drive closes its fence and waits for
 *   its writes in flight before it reads the log again. A restart keeps
 *   the slot for the drive that continues the run.
 * - I7 After `release()`, `take` and `hold` reject, queued Turns that have
 *   not begun reject, the cap queue, the sweep and the wake timers stop,
 *   and every drive's fence closes. A Turn already in flight may finish
 *   (`release` waits for it, up to `RELEASE_WAIT_MS`), but it begins no
 *   drive.
 * - I8 A Turn waits on no harness and no timer. The one wait is an
 *   answer's: until the Gate closed (its step ended, or opened again), or
 *   no drive holds the run.
 * - I9 A Turn reads the run's row and refuses a run another Device walks
 *   now (a move is a Turn too), with the one refusal for that rule
 *   (`walked-elsewhere`). The person's actions ask the same rule before
 *   they queue (`runs/actions/`); this read is for a move that came
 *   between.
 * - I10 One cap queue, first in first out, one entry per run. A freed
 *   slot runs every queued retry once; each retry is a new Turn that
 *   checks again.
 * - I11 No Turn waits for a Turn of its own run: that is a deadlock. A
 *   `take` or `hold` of a run from inside a Turn of that run throws.
 * - I12 A Turn of a run that moved here and has not arrived (no
 *   `WalkerArrived` yet, `runsArriving`) is refused (`arriving`): it has
 *   no Checkpoint here. Only its take-over holds it (`hold`, `arrival`).
 *   The overdue check and the prune leave it. Its test moves a run
 *   between two computers (`test/engine/move.test.ts`).
 *
 * The runner keeps one state per run (`RunnerState`, `run-slots.ts`) and
 * splits its work by what each part does with it: the Turn queue, the
 * slots and the cap (`run-slots.ts`), the drive and the end of open work
 * (`drive.ts`), and one phase per intent (`turns.ts`). This file composes
 * them, in the order they are made, with the sleeps, the overdue sweep and
 * the release.
 */

/** How long the sweep waits between two looks at the steps' time. */
const DEFAULT_OVERDUE_SWEEP_MS = 5_000;

export type Runner = ReturnType<typeof createRunner>;

export function createRunner(deps: RunnerDeps) {
	const { db, shared } = deps;
	const { log, bus, recorders } = shared;
	const open = deps.openThread ?? openThread;
	const holds = deps.holds ?? NO_HOLDS;
	const closeDeps: CloseDeps = {
		log,
		bus,
		flowOf: deps.flowOf,
		calledFlowsOf: deps.calledFlowsOf,
		holds,
	};
	const state = createRunnerState();
	const { threads, slots, capQueue } = state;
	const queue = createTurnQueue(state, {
		shared,
		take: (runId, intent, options) => take(runId, intent, options),
	});
	const { outside, walkOf, refuseTurn, inTurn } = queue;

	const sleeps = createSleeps({
		now: shared.now,
		wake: (runId) =>
			outside(() => {
				take(
					runId,
					{ kind: "wake", early: false },
					{ whenFull: "queue" },
				).catch((error) => {
					console.error(`[engine] could not wake run ${runId}`, error);
				});
			}),
	});

	const sweep = setInterval(
		() => sweepOverdue(),
		deps.overdueSweepMs ?? DEFAULT_OVERDUE_SWEEP_MS,
	);
	sweep.unref?.();

	function dispose(): void {
		clearInterval(sweep);
		sleeps.dispose();
		capQueue.clear();
		threads.clear();
	}
	deps.signal?.addEventListener("abort", dispose, { once: true });

	/**
	 * Lets go of every run this runner drives, writing nothing: each drive's
	 * fence closes (its late writes are dropped), its harness is aborted, and
	 * its writes in flight settle. For a handover to a new engine in the
	 * same process (`bun --hot`): without it the old drives run on beside
	 * the runs the new engine resumes, and their timers and late writes end
	 * steps that are no longer theirs. The new engine's recovery ends the
	 * open work `interrupted`, as after a restart.
	 *
	 * New Turns are refused at once (I7). The Turns in flight may finish,
	 * but begin no drive; `release` waits for them up to `RELEASE_WAIT_MS`,
	 * so a start in flight has written what it writes before the next
	 * engine's recovery reads the log.
	 */
	async function release(): Promise<void> {
		state.released = true;
		capQueue.clear();
		const held = [...slots];
		slots.clear();
		await Promise.all(
			held.map(async ([runId, slot]) => {
				// An answer that waits for its step lets go.
				bus.publish(runId, { kind: "status-changed" });
				if (slot === "starting" || slot === "handed") return;
				const settled = slot.thread?.fence.close() ?? Promise.resolve();
				slot.controller.abort();
				await settled;
			}),
		);
		await queue.settleTurns();
		dispose();
	}

	/** Whether the run moved here and has not arrived (`runsArriving`). */
	async function arriving(runId: string): Promise<boolean> {
		const here = [await log.walkerId()];
		return (await runsArriving(db, here, [runId])).length > 0;
	}

	const drives = createDrives(state, {
		deps,
		open,
		holds,
		closeDeps,
		queue,
		sleeps,
	});
	const { turnFor } = createTurns(state, {
		deps,
		open,
		queue,
		drives,
		sleeps,
		arriving,
	});

	/**
	 * Takes the run for one Turn: what `intent` asks, in the run's queue
	 * (I1). A wake waits for the drive that began the sleep to unwind first,
	 * outside the queue, so a stop is never held behind it.
	 */
	async function take(
		runId: string,
		intent: Intent,
		options: TakeOptions = {},
	): Promise<Taken> {
		refuseTurn(runId);
		const walk = walkOf(runId);
		if (walk && intent.kind === "answer" && !intent.queued) {
			return queueAnswer(runId, intent, options);
		}
		if (
			walk &&
			(intent.kind === "wake" ||
				(intent.kind === "resume" &&
					(await log.state(runId)).status === "sleeping"))
		) {
			return afterYield(runId, intent, options);
		}
		return inTurn(runId, (turn) => turnFor(runId, intent, options, turn));
	}

	/**
	 * An answer while a drive holds the run. What is known now is refused
	 * now: the caller's check, and a second answer while one waits. The
	 * answer becomes a fact (`AnswerQueued`): the Gate shows it as on its
	 * way, and a new daemon passes it on (`restore`). Its Turn comes at the
	 * drive's next hold (`passOn`).
	 */
	async function queueAnswer(
		runId: string,
		intent: Extract<Intent, { kind: "answer" }>,
		options: TakeOptions,
	): Promise<Taken> {
		const runState = await log.state(runId);
		options.check?.(runState);
		const step = runState.steps.get(intent.stepId);
		if (step?.endedAt === null && step.gate?.queued) {
			throw new RunRefusal("gate-closed", CONTINUED);
		}
		const { stepId, choice, note, data, via } = intent;
		await log.append({
			type: "AnswerQueued",
			runId,
			stepId,
			payload: {
				choice,
				note,
				...(data !== undefined ? { data } : {}),
				...(via ? { via } : {}),
			},
		});
		bus.publish(runId, { kind: "step-changed", stepId });
		passOn(runId, { ...intent, queued: true }, options);
		return { kind: "queued" };
	}

	/**
	 * The Turn of an answer that waits (`AnswerQueued`), in the background.
	 * When the Gate no longer takes it, a warning on the Gate's step says
	 * why (`answer-dropped`), so the screens show it. A runner that lets go
	 * writes nothing: the next one passes the answer on.
	 */
	function passOn(
		runId: string,
		intent: Extract<Intent, { kind: "answer" }>,
		options: TakeOptions,
	): void {
		outside(() => {
			afterYield(runId, intent, options).catch(async (error) => {
				if (state.released) return;
				if (!(error instanceof Refusal)) {
					console.error(`[engine] could not answer run ${runId}`, error);
				}
				try {
					await log.append({
						type: "RunWarned",
						runId,
						stepId: intent.stepId,
						payload: {
							kind: "answer-dropped",
							message: `${ANSWER_DROPPED} ${wordsFor(error)}`,
						},
					});
					bus.publish(runId, { kind: "step-changed", stepId: intent.stepId });
					// The Gate waits again: its deadline, which left it to the
					// answer, counts again.
					sleeps.restore(runId, await log.state(runId));
				} catch (failed) {
					console.error(`[engine] could not warn run ${runId}`, failed);
				}
			});
		});
	}

	/**
	 * A Turn for a run a drive holds: the drive parks at its next hold and
	 * keeps its slot for the Turn (`hand-over`), so a full run cap cannot
	 * hold the Turn back. A drive another Turn began meanwhile is waited for
	 * the same way. When the Turn moved nothing (a refusal, a wake too
	 * soon), the drive goes on in the same Turn (`go-on`), so the branches
	 * beside the interrupts do not stop there. A slot left over goes.
	 */
	async function afterYield(
		runId: string,
		intent: Intent,
		options: TakeOptions,
	): Promise<Taken> {
		for (;;) {
			for (let walk = walkOf(runId); walk; walk = walkOf(runId)) {
				walk.yielding = "hand-over";
				await walk.done;
			}
			const taken = await inTurn(runId, async (turn) => {
				if (walkOf(runId)) return null;
				try {
					return await turnFor(runId, intent, options, turn);
				} finally {
					await turnFor(runId, { kind: "go-on" }, {}, turn).catch((error) => {
						if (error instanceof Refusal) return;
						console.error(`[engine] could not drive run ${runId} on`, error);
					});
					if (slots.get(runId) === "handed") {
						slots.delete(runId);
						turn.freed = true;
					}
				}
			});
			if (taken) return taken;
		}
	}

	/**
	 * A new daemon's timer from `runState`, and the answers that wait for
	 * the run's drive (`AnswerQueued`). Those come from the run's whole log:
	 * a caller may fold only the events that open or close work (startup
	 * recovery). A full run cap queues them: none is dropped.
	 */
	function restore(runId: string, runState: RunState): void {
		sleeps.restore(runId, runState);
		log
			.state(runId)
			.then((full) => passOnQueued(runId, full))
			.catch((error) => {
				console.error(`[engine] could not read run ${runId}`, error);
			});
	}

	/** Passes on each answer that waits for the run's drive (`AnswerQueued`). */
	function passOnQueued(runId: string, runState: RunState): void {
		for (const step of runState.steps.values()) {
			const queued = step.endedAt === null ? step.gate?.queued : null;
			if (!queued) continue;
			const { choice, note, data, via } = queued;
			passOn(
				runId,
				{
					kind: "answer",
					stepId: step.id,
					choice,
					note,
					...(data !== undefined ? { data } : {}),
					...(via ? { via } : {}),
					queued: true,
				},
				{
					whenFull: "queue",
					// Once a slot frees, the answer goes on if it still waits.
					retry: () => {
						log
							.state(runId)
							.then((now) => {
								const still = now.steps.get(step.id);
								if (still?.endedAt !== null || !still.gate?.queued) return;
								passOnQueued(runId, {
									...now,
									steps: new Map([[step.id, still]]),
								});
							})
							.catch((error) => {
								console.error(`[engine] could not read run ${runId}`, error);
							});
					},
				},
			);
		}
	}

	/**
	 * A Turn that drives nothing: `fn` sees the run's row, its log, and
	 * whether a drive or a Turn holds a slot of it, and no other Turn of the
	 * run comes in between. For an action that writes one fact (a stop
	 * after the step, a move). A run that still arrives here is refused
	 * (I12), unless the Turn is its take-over (`arrival`).
	 */
	async function hold<T>(
		runId: string,
		fn: (held: Held) => Promise<T>,
		options: { arrival?: boolean } = {},
	): Promise<T> {
		return inTurn(runId, async () => {
			const row = await log.row(runId);
			if (!(await log.walkedHere(row))) {
				throw new RunRefusal("walked-elsewhere", WALKED_ELSEWHERE);
			}
			if (!options.arrival && (await arriving(runId))) {
				throw new RunRefusal("arriving", ARRIVING);
			}
			return fn({
				row,
				runState: await log.state(runId),
				active: slots.has(runId),
			});
		});
	}

	/** The runs whose overdue check has not settled yet. */
	const checking = new Set<string>();
	/**
	 * Checks the running step of every run this process drives against its
	 * recorded limits (`overdue`). The steps' own timers stay the fast path,
	 * so a step must be a minute past its limit (one `minuteMs`) before this
	 * ends it.
	 *
	 * Each run's check is its own Turn, in its own queue, and the sweep
	 * waits for none of them: a run whose Turns are slow holds back only its
	 * own check. A run whose last check has not settled is left out, so
	 * checks never pile up behind it. There is at most one check per slot,
	 * so the run cap bounds how many run at once.
	 */
	function sweepOverdue(): void {
		if (state.released) return;
		for (const runId of slots.keys()) {
			if (checking.has(runId)) continue;
			checking.add(runId);
			take(runId, { kind: "overdue", graceMs: shared.minuteMs })
				.catch((error) => {
					console.error(
						`[engine] could not check the time of run ${runId}`,
						error,
					);
				})
				.finally(() => checking.delete(runId));
		}
	}

	return {
		take,
		hold,
		/** Whether a drive or a Turn holds a slot of the run. */
		isActive: (runId: string): boolean => slots.has(runId),
		/**
		 * A new daemon's wake timer from the log, or a moved-in run's
		 * (`graph/runner/wake.ts`), and the answers that wait for its drive.
		 */
		restore,
		/**
		 * Drops what this runner keeps of a run that another Device walks
		 * now: its compiled thread, its wake timer and its place in the cap
		 * queue.
		 */
		forget(runId: string): void {
			threads.delete(runId);
			sleeps.forget(runId);
			capQueue.delete(runId);
		},
		/** A run moved here: its transcript continues after `seq`, the last entry its old Walker wrote. */
		continueTranscriptAfter: recorders.continueAfter,
		release,
		dispose,
	};
}
