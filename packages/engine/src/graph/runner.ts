import type { Database } from "@nightshift/db";
import type {
	Flow,
	FlowNode,
	JsonValue,
	ResolvedPolicy,
} from "@nightshift/flows";
import type { Device } from "../device";
import type { RunSettings } from "../device-config";
import type {
	LoggedEvent,
	RunBus,
	RunEnding,
	RunLog,
	RunRow,
	RunStatus,
} from "../log";
import { deriveRunState } from "../read";
import { createRecorders, messageOf } from "./context";
import { findOverdue } from "./deadlines";
import { FencedError } from "./fence";
import {
	type CloseDeps,
	type CutShort,
	closeOpenWork as closeWork,
} from "./open-work";
import { loggedVisits, reenteredNode, reentryUpdate } from "./reentry";
import { createSleeps } from "./sleep";
import type { Parked, ResumeValue, RunEvent, RunStateUpdate } from "./state";
import {
	endingOf,
	inputOf,
	openThread,
	type StreamInput,
	type Thread,
	type ThreadDeps,
	type ThreadState,
} from "./thread";

/**
 * The per-run driver: every run is one LangGraph thread (thread id = run
 * id) on a graph compiled from the run's flow snapshot (design rule 1),
 * opened and streamed by the Thread module (`thread.ts`). The runner
 * drives the thread, reacts to how a drive ended, appends `RunEnded`, and
 * owns what the walk owned around the steps: the slots and
 * the run cap, the per-run `exclusive` queue, and a stop. A stop waits for
 * nothing: it fences the drive off (`fence.ts`) and ends the run's open
 * work itself (`closeOpenWork`). A step past the time limits its log
 * records ends the same way (`endIfOverdue`, `deadlines.ts`). The wake
 * timers and the wake of a sleeping run are the sleep module's (`sleeps`,
 * `graph/sleep.ts`), given the runner's thread seam.
 *
 * - `start` streams `{ inputs }`; `continueRun` streams `null` (the node a
 *   dead daemon left pending re-runs, rule 5); `resume` streams
 *   `Command({ resume })` into the interrupt the thread sits at; `reenter`
 *   jumps to a node of a thread that ended or never started (which node,
 *   and the seed state: `reenteredNode` and `reentryUpdate` in
 *   reentry.ts).
 * - A drive that parks at the root's interrupt: a `wait` schedules the
 *   wake timer with the sleep module (`WaitStarted` is in the log
 *   already); a `gate` needs nothing (the Gate node logged `GateOpened`);
 *   `parked` appends `RunEnded` with its status and reason (`endingOf`).
 * - A stream that ends with `state.ended` set appends `RunEnded finished`
 *   and prunes the thread to its latest checkpoint (the log is the
 *   record); one that throws appends `RunEnded failed` with `The engine
 *   failed: …`.
 * - The custom stream chunks (`RunEvent`) are the runner's bookkeeping:
 *   transcript entries reach the bus from the recorder already.
 *
 * Over 600 lines on purpose: the drive, the interrupts, the stop and the
 * slots of a run share one state per run, so they stay in one module.
 */

export type RunnerDeps = {
	db: Database;
	log: RunLog;
	bus: RunBus;
	dataDir: string;
	now(): number;
	minuteMs: number;
	settings(): RunSettings;
	/** The Device a step of `node` runs on (`StepContext.deviceFor`). */
	deviceFor(node: FlowNode, run: RunRow): Device;
	/** A Device by id, for a run (`StepContext.deviceById`). */
	deviceById(id: string, run: RunRow): Device;
	/** The run's flow snapshot and its called flows, parsed. */
	flowOf(row: RunRow): Flow;
	calledFlowsOf(row: RunRow): Record<string, Flow>;
	/** The flow's own policy numbers, else the daemon's settings. */
	policyFor(flow: Flow): ResolvedPolicy;
	/** Aborting it clears the wake timers and ignores later wakes: the daemon dies. */
	signal?: AbortSignal;
	/** Called after a drive ended and its slot freed, once the queued wakes drained. */
	onSlotFreed?: () => void;
};

type Walk = {
	/** Aborts when a person stops the run. */
	controller: AbortController;
	done: Promise<void>;
	/** The thread the drive streams; null until the drive compiled it. */
	thread: Thread | null;
};

/** A slot is reserved before any await, so two calls cannot both pass the cap. */
type Slot = Walk | "starting";

/** A restart that came after the drive ended the run itself: there is no step left to restart. */
export class RestartTooLate extends Error {
	constructor(readonly status: RunStatus) {
		super(`The step ended before it could restart. The run is ${status} now.`);
		this.name = "RestartTooLate";
	}
}

export type Runner = ReturnType<typeof createRunner>;

export function createRunner(deps: RunnerDeps) {
	const { db, log, bus } = deps;
	const recorders = createRecorders({ db, bus });
	const threadDeps: ThreadDeps = {
		db,
		log,
		bus,
		recorders,
		dataDir: deps.dataDir,
		now: deps.now,
		minuteMs: deps.minuteMs,
		settings: deps.settings,
		deviceFor: deps.deviceFor,
		deviceById: deps.deviceById,
		flowOf: deps.flowOf,
		calledFlowsOf: deps.calledFlowsOf,
		policyFor: deps.policyFor,
	};
	/** Open threads by run id, kept while the run is likely to continue soon. */
	const threads = new Map<string, Thread>();
	/** Keyed by run id: the runs that walk in this process. */
	const slots = new Map<string, Slot>();
	/** Per-run queues: answering, stopping, waking and closing never interleave. */
	const runLocks = new Map<string, Promise<void>>();
	/** The sleep module's daemon side, on this runner's thread seam (the functions below are hoisted). */
	const sleeps = createSleeps({
		db,
		log,
		bus,
		now: deps.now,
		recorders,
		thread: {
			async settled(runId) {
				// The drive that began the wait may still be unwinding.
				const slot = slots.get(runId);
				if (slot && slot !== "starting") await slot.done;
			},
			exclusive,
			state: threadState,
			reserveSlot,
			releaseStartingSlot,
			resume: (row, value) => drive(row, inputOf({ kind: "resume", value })),
		},
	});

	function dispose(): void {
		sleeps.dispose();
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
	 */
	async function release(): Promise<void> {
		const walks = [...slots.values()].filter(
			(slot): slot is Walk => slot !== "starting",
		);
		slots.clear();
		await Promise.all(
			walks.map(async (walk) => {
				const settled = walk.thread?.fence.close() ?? Promise.resolve();
				walk.controller.abort();
				await settled;
			}),
		);
		dispose();
	}

	/** The run's open thread; opened once per run, from its snapshot. */
	function threadOf(row: RunRow): Thread {
		const cached = threads.get(row.id);
		if (cached) return cached;
		const thread = openThread(row, threadDeps);
		threads.set(row.id, thread);
		return thread;
	}

	/** Runs `fn` after every earlier `exclusive` call for the same run has settled. */
	function exclusive<T>(runId: string, fn: () => Promise<T>): Promise<T> {
		const previous = runLocks.get(runId) ?? Promise.resolve();
		const current = previous.then(fn);
		const tail = current.then(
			() => {},
			() => {},
		);
		runLocks.set(runId, tail);
		void tail.then(() => {
			if (runLocks.get(runId) === tail) runLocks.delete(runId);
		});
		return current;
	}

	function reserveSlot(runId: string): void {
		if (slots.has(runId)) {
			throw new Error(
				"This run is still running. Stop it or wait for it to end.",
			);
		}
		const runCap = deps.settings().maxConcurrentRuns;
		if (slots.size >= runCap) {
			throw new Error(
				`The run cap is reached: ${slots.size} of ${runCap} runs are running. Stop a run or wait for one to end.`,
			);
		}
		slots.set(runId, "starting");
	}

	function releaseStartingSlot(runId: string): void {
		if (slots.get(runId) === "starting") slots.delete(runId);
	}

	/** Appends `RunEnded` through `writer`: a drive's own fenced log, or the runner's. */
	async function endRun(
		writer: RunLog,
		runId: string,
		status: RunEnding,
		reason: string | null,
	): Promise<void> {
		try {
			await writer.append({
				type: "RunEnded",
				runId,
				payload: { status, reason },
			});
		} catch (error) {
			// A stop took the run from the drive and wrote its end.
			if (error instanceof FencedError) return;
			// The next start marks the run interrupted.
			console.error(`[engine] could not record the end of run ${runId}`, error);
		}
	}

	/**
	 * Takes over a reserved slot and drives the thread in the background.
	 * The slot is released when the drive ends, however it ends.
	 */
	function drive(row: RunRow, input: StreamInput): void {
		const runId = row.id;
		const walk: Walk = {
			controller: new AbortController(),
			done: Promise.resolve(),
			thread: null,
		};
		slots.set(runId, walk);
		bus.publish(runId, { kind: "status-changed" });
		walk.done = driveThread(row, walk, input).finally(() => {
			if (slots.get(runId) === walk) slots.delete(runId);
			bus.publish(runId, { kind: "status-changed" });
			sleeps.drain();
			deps.onSlotFreed?.();
		});
	}

	/**
	 * Drives the thread and records how the drive ended. A drive whose
	 * fence a stop closed records nothing: the stop wrote the run's end.
	 */
	async function driveThread(
		row: RunRow,
		walk: Walk,
		input: StreamInput,
	): Promise<void> {
		const runId = row.id;
		let thread: Thread | undefined;
		try {
			// Before the first await: a stop that comes in later finds the thread.
			thread = threadOf(row);
			walk.thread = thread;
			const outcome = await thread.drive(input, {
				controller: walk.controller,
				onEvent: (event) => onCustom(runId, event),
			});
			if (outcome.kind === "parked") onInterrupt(runId, outcome.parked);
			const ending = endingOf(outcome);
			if (!ending) return;
			dropThread(runId, thread);
			await endRun(thread.ctx.log, runId, ending.status, ending.reason);
			if (outcome.kind === "ended") await pruneThread(thread, runId);
		} catch (error) {
			// A stop took the run from this drive: it writes nothing more.
			if (thread?.fence.closed) return;
			console.error(`[engine] the walk of run ${runId} failed`, error);
			await endRun(
				thread?.ctx.log ?? log,
				runId,
				"failed",
				`The engine failed: ${messageOf(error)}`,
			);
		}
	}

	/** Drops the run's compiled thread from the cache, when it is still `thread`. */
	function dropThread(runId: string, thread: Thread): void {
		if (threads.get(runId) === thread) threads.delete(runId);
	}

	/**
	 * Keeps a finished run's latest checkpoint and deletes the older ones
	 * and the body namespaces. The history was the walk's bookkeeping and
	 * the event log is the record; the final state is what `resumeRun` of a
	 * finished run re-enters on (`reenter`).
	 */
	async function pruneThread(thread: Thread, runId: string): Promise<void> {
		try {
			await thread.prune();
		} catch (error) {
			if (error instanceof FencedError) return;
			console.error(
				`[engine] could not prune the checkpoints of run ${runId}`,
				error,
			);
		}
	}

	/** A step started or ended: the run's status may have changed with it. */
	function onCustom(runId: string, event: RunEvent): void {
		if (event.type === "step-started" || event.type === "step-ended") {
			bus.publish(runId, { kind: "status-changed" });
		}
	}

	/**
	 * The root's interrupt ended the drive. A stop that came in while the
	 * wait began or the Gate opened closed the drive's fence, so the drive
	 * never gets here: the stop closed the parked step itself. A `parked`
	 * step ends the run (`endingOf`); a Gate needs nothing.
	 */
	function onInterrupt(runId: string, parked: Parked): void {
		// A wait with no time (a signal with no timeout) has no timer.
		if (parked.kind === "wait" && parked.until !== null) {
			sleeps.schedule(runId, parked.until);
		}
	}

	/**
	 * Takes the run from its drive at once, without waiting for it: closes
	 * the drive's fence (it writes nothing more, `fence.ts`), frees its slot
	 * and its compiled thread (a resume drives a new thread while the old
	 * drive unwinds, or hangs), and aborts it (the harness process is
	 * signalled and killed). Resolves once the drive's writes in flight
	 * settled; it waits on no timer.
	 */
	async function takeFromDrive(
		runId: string,
		walk: Walk,
		options: { keepSlot?: boolean } = {},
	): Promise<void> {
		const settled = walk.thread?.fence.close() ?? Promise.resolve();
		if (slots.get(runId) === walk) {
			// A restart keeps the slot for the drive that continues the run,
			// so no other run takes it in between.
			if (options.keepSlot) slots.set(runId, "starting");
			else slots.delete(runId);
		}
		if (walk.thread) dropThread(runId, walk.thread);
		walk.controller.abort();
		await settled;
	}

	const closeDeps: CloseDeps = {
		db,
		log,
		bus,
		flowOf: deps.flowOf,
		calledFlowsOf: deps.calledFlowsOf,
	};

	/**
	 * Ends the run's open work as `cut` says (`graph/open-work.ts`): its
	 * open sessions, then its open steps from the inside out, then the run.
	 * The run's wake timer goes first. The thread stays where it is: a
	 * resume re-enters it (design rule 7), at its interrupt or at the node
	 * the drive was in.
	 */
	async function closeOpenWork(runId: string, cut: CutShort): Promise<void> {
		sleeps.forget(runId);
		await closeWork(closeDeps, runId, cut);
	}

	/** A drive's slot is free: what waited for one may go now. */
	function slotFreed(runId: string): void {
		// The old drive may never unwind to free its slot itself.
		bus.publish(runId, { kind: "status-changed" });
		sleeps.drain();
		deps.onSlotFreed?.();
	}

	/**
	 * Stops the run now, whatever its drive does: takes the run from the
	 * running drive (`takeFromDrive`) and ends its open work as stopped
	 * (`closeOpenWork`), or closes a run that waits at a Gate or sleeps.
	 * Waits on no drive and no timer: a harness that hangs cannot hold a
	 * stop. No-op when nothing runs, waits or sleeps.
	 */
	async function stop(runId: string): Promise<void> {
		let freed = false;
		await exclusive(runId, async () => {
			const slot = slots.get(runId);
			if (slot === "starting") return;
			if (slot) {
				await takeFromDrive(runId, slot);
				freed = true;
			}
			const status = deriveRunState(await log.events(runId)).status;
			const parked = status === "waiting" || status === "sleeping";
			if (!slot && !parked) return;
			await log.append({ type: "StopRequested", runId, payload: {} });
			// A drive may have ended the run before the stop took it.
			if (status === "running" || parked) {
				await closeOpenWork(runId, { kind: "stopped" });
			}
		});
		if (freed) slotFreed(runId);
	}

	/**
	 * Stops the running step and hands the run to `next` in one turn of the
	 * run's queue (`exclusive`), so no answer, stop, wake or other restart
	 * comes in between. `check` sees the log first and throws to refuse.
	 *
	 * The running drive is taken as a stop takes it (`takeFromDrive`): its
	 * fence closes (it writes nothing more, its harness is aborted), and its
	 * writes in flight settle before the log is read again. Its slot stays
	 * reserved for `next`, which drives the run on (`drive` takes the slot
	 * over); a slot `next` did not take is freed. A run the log says runs
	 * but no drive in this process holds (its drive died) is closed the
	 * same way: nothing can write to it. The open work ends `stopped`
	 * (`StopRequested`, then `closeOpenWork`).
	 *
	 * When the drive ended the run itself just before its fence closed,
	 * there is nothing left to restart: throws `RestartTooLate` with the
	 * run as it ended.
	 */
	async function restart(
		runId: string,
		check: (events: readonly LoggedEvent[]) => void,
		next: () => Promise<void>,
	): Promise<void> {
		let took = false;
		try {
			await exclusive(runId, async () => {
				const slot = slots.get(runId);
				if (slot === "starting") {
					throw new Error("The run is starting. Try again in a moment.");
				}
				check(await log.events(runId));
				if (slot) await takeFromDrive(runId, slot, { keepSlot: true });
				else reserveSlot(runId);
				took = true;
				try {
					const status = deriveRunState(await log.events(runId)).status;
					if (
						status !== "running" &&
						status !== "waiting" &&
						status !== "sleeping"
					) {
						throw new RestartTooLate(status);
					}
					await log.append({ type: "StopRequested", runId, payload: {} });
					await closeOpenWork(runId, { kind: "stopped" });
					await next();
				} finally {
					releaseStartingSlot(runId);
				}
			});
		} finally {
			// The old drive may never unwind to free its slot itself.
			if (took) slotFreed(runId);
		}
	}

	/**
	 * Ends the run's running step when it ran past its time budget or its
	 * idle limit by `graceMs` or more, as the recorded limits say
	 * (`findOverdue`): the step and the run end as the step's timer ends
	 * them, through the stop's path (`takeFromDrive`, `closeOpenWork`), so
	 * a drive that hangs writes nothing more. True when it ended one.
	 */
	async function endIfOverdue(
		runId: string,
		graceMs: number,
	): Promise<boolean> {
		let freed = false;
		const ended = await exclusive(runId, async () => {
			const slot = slots.get(runId);
			if (slot === "starting") return false;
			const events = await log.events(runId);
			if (deriveRunState(events).status !== "running") return false;
			const overdue = await findOverdue(events, {
				now: deps.now(),
				graceMs,
				minuteMs: deps.minuteMs,
			});
			if (!overdue) return false;
			if (slot) {
				await takeFromDrive(runId, slot);
				freed = true;
			}
			await closeOpenWork(runId, { kind: "overdue", ...overdue });
			return true;
		});
		if (freed) slotFreed(runId);
		return ended;
	}

	/**
	 * Checks the running step of every run this process drives against its
	 * recorded limits (`endIfOverdue`). The timers stay the fast path, so a
	 * step must be a minute past its limit (one `minuteMs`) before this
	 * ends it.
	 */
	async function endOverdueSteps(): Promise<void> {
		for (const runId of [...slots.keys()]) {
			try {
				await endIfOverdue(runId, deps.minuteMs);
			} catch (error) {
				console.error(
					`[engine] could not check the time of run ${runId}`,
					error,
				);
			}
		}
	}

	/** Where the run's thread is, from its latest checkpoint. */
	function threadState(row: RunRow): Promise<ThreadState> {
		return threadOf(row).state();
	}

	return {
		reserveSlot,
		releaseStartingSlot,
		/** Whether the run holds a slot: it is starting or a drive runs. */
		isActive: (runId: string): boolean => slots.has(runId),
		activeCount: (): number => slots.size,
		exclusive,
		/** Starts the thread at the flow's start node with the run's inputs and stop time. Takes over a reserved slot. */
		start(
			row: RunRow,
			inputs: Record<string, JsonValue>,
			stopAt: number | null,
		): void {
			drive(row, inputOf({ kind: "start", inputs, stopAt }));
		},
		/**
		 * Re-runs the node the thread is pending at (a daemon death or an
		 * engine failure). `update` writes state first (a cleared stop time).
		 */
		continueRun(row: RunRow, update?: RunStateUpdate): void {
			drive(row, inputOf({ kind: "continue", ...(update ? { update } : {}) }));
		},
		/** Answers the interrupt the thread sits at; `update` writes state before the node continues. */
		resume(row: RunRow, value: ResumeValue, update?: RunStateUpdate): void {
			drive(
				row,
				inputOf({ kind: "resume", value, ...(update ? { update } : {}) }),
			);
		},
		/**
		 * Jumps to a top-level node of a thread that reached END or never
		 * ran. A finished run re-enters on its own latest checkpoint: `ended`
		 * and `pending` cleared, and the `reenteredNode`'s last visit taken
		 * back so the node reopens its step. A thread with no checkpoint (a
		 * run from before this engine) is seeded from the log
		 * (`reentryUpdate`). `update` writes on top (a cleared stop time).
		 */
		async reenter(
			row: RunRow,
			nodeId: string,
			events: readonly LoggedEvent[],
			update?: RunStateUpdate,
		): Promise<void> {
			const thread = threadOf(row);
			const snapshot = await thread.snapshot();
			let seed: RunStateUpdate;
			if (!snapshot.hasCheckpoint) {
				seed = reentryUpdate(thread.ctx.flow, events);
			} else {
				const reentered = reenteredNode(events);
				const visits = snapshot.values.visits ?? {};
				const committed = reentered ? (visits[reentered] ?? 0) : 0;
				seed = {
					ended: null,
					pending: null,
					...(reentered && committed > 0
						? { visits: { [reentered]: committed - 1 } }
						: {}),
				};
			}
			drive(
				row,
				inputOf({ kind: "goto", nodeId, update: { ...seed, ...update } }),
			);
		},
		/**
		 * Walks the run again from `nodeId`, a top-level node, with a new
		 * visit of it. The thread may be anywhere: parked at an interrupt,
		 * pending at a node, at END, or without a checkpoint. A thread that
		 * still has a task (an interrupt, or a node a stop or a death cut
		 * short) has it cleared first (`updateState(…, END)`), so only the
		 * jump runs. The visits are set to the log's counts (`loggedVisits`):
		 * no step of an earlier walk is taken up again. The cursors of Calls
		 * with `each` are cleared, so a Call starts its list over. Inputs,
		 * node outputs and edge counts stay. `update` writes on top (a
		 * cleared stop time). Takes over a reserved slot.
		 */
		async rerun(
			row: RunRow,
			nodeId: string,
			events: readonly LoggedEvent[],
			update?: RunStateUpdate,
		): Promise<void> {
			const thread = threadOf(row);
			const snapshot = await thread.snapshot();
			let seed: RunStateUpdate;
			if (!snapshot.hasCheckpoint) {
				seed = reentryUpdate(thread.ctx.flow, events, null);
			} else {
				if (snapshot.hasTasks) await thread.clearTasks();
				const { loops } = snapshot.values;
				seed = {
					ended: null,
					pending: null,
					visits: loggedVisits(thread.ctx.flow, events, null),
					loops: Object.fromEntries(
						Object.keys(loops ?? {}).map((id) => [id, null]),
					),
				};
			}
			drive(
				row,
				inputOf({ kind: "goto", nodeId, update: { ...seed, ...update } }),
			);
		},
		threadState,
		/**
		 * Drops what this runner keeps of a run that another Device walks
		 * now: its compiled thread and its wake timer.
		 */
		forget(runId: string): void {
			threads.delete(runId);
			sleeps.forget(runId);
		},
		/** The sleeping runs: `wake(runId, how)`, `restore(runId, events)` (`graph/sleep.ts`). */
		sleeps,
		/** A run moved here: its transcript continues after `seq`, the last entry its old Walker wrote. */
		continueTranscriptAfter: recorders.continueAfter,
		stop,
		restart,
		release,
		endIfOverdue,
		endOverdueSteps,
		dispose,
	};
}
