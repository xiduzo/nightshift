import { AsyncLocalStorage } from "node:async_hooks";
import type { Database } from "@nightshift/db";
import type {
	Flow,
	FlowNode,
	JsonValue,
	ResolvedPolicy,
} from "@nightshift/flows";
import type { Device } from "../device";
import type { RunSettings } from "../device-config";
import {
	getRunRow,
	type LoggedEvent,
	type ResumedBy,
	type RunBus,
	type RunEnding,
	type RunLog,
	type RunRow,
	type RunStatus,
} from "../log";
import { deriveRunState, deriveSteps } from "../read";
import { RunRefusal, WALKED_ELSEWHERE } from "../run-status";
import { createRecorders, messageOf } from "./context";
import { findOverdue } from "./deadlines";
import { FencedError } from "./fence";
import { type CloseDeps, type CutShort, closeOpenWork } from "./open-work";
import { planReentry, type ReentryRequest } from "./reentry";
import { createSleeps, planWake, recordWake, type Wake } from "./sleep";
import type { Parked, RunEvent } from "./state";
import {
	endingOf,
	inputOf,
	openThread,
	type StreamInput,
	type Thread,
	type ThreadDeps,
} from "./thread";

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
 * - A run that ended (finished, failed, stopped) keeps only the
 *   checkpoints a re-entry reads (`Thread.prune`): the log is the record.
 *   One that a dead daemon left is pruned by startup recovery (`prune`).
 * - How a sleep ends is the sleep module's (`planWake`, `recordWake`,
 *   `graph/sleep.ts`); how a re-entry moves the thread is the planner's
 *   (`planReentry`, `graph/reentry.ts`).
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
 *   answer's: until the Gate's step ended, or no drive holds the run.
 * - I9 A Turn reads the run's row and refuses a run another Device walks
 *   now (a move is a Turn too), with the one refusal for that rule
 *   (`walked-elsewhere`). The person's actions ask the same rule before
 *   they queue (`run/actions.ts`); this read is for a move that came
 *   between.
 * - I10 One cap queue, first in first out, one entry per run. A freed
 *   slot runs every queued retry once; each retry is a new Turn that
 *   checks again.
 * - I11 No Turn waits for a Turn of its own run: that is a deadlock. A
 *   `take` or `hold` of a run from inside a Turn of that run throws.
 *
 * Over 600 lines on purpose: the drive, the slots, the queues and the
 * stop of a run share one state per run, so they stay in one module.
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
	/** Aborting it clears the wake timers, the cap queue and the sweep: the daemon dies. */
	signal?: AbortSignal;
	/** How often the runner looks for steps past their time limits. Default 5 000 ms. */
	overdueSweepMs?: number;
	/** Opens a run's thread. Default `openThread`; a test passes one that fails. */
	openThread?: typeof openThread;
};

/** What a start's Turn prepares once its slot is held: the run row, its inputs and its stop time. */
export type StartPlan = {
	row: RunRow;
	inputs: Record<string, JsonValue>;
	stopAt: number | null;
};

/** What a Turn does to a run. */
export type Intent =
	/** Starts a new run. `prepare` runs with the slot held: it writes the row and `RunStarted`. */
	| { kind: "start"; prepare(): Promise<StartPlan> }
	/**
	 * Answers the run's open Gate. The Turn ends once the Gate's step has
	 * ended. The caller checks the answer against the Gate (`check`).
	 */
	| { kind: "answer"; stepId: string; choice: string; note: string }
	/** Ends the sleep of a sleeping run (`planWake`): its timer, a person early, or a signal. */
	| ({ kind: "wake" } & Wake)
	/** Continues a run that is not going (`planReentry`), or wakes a sleeping one early with `prompt`. */
	| { kind: "resume"; by: ResumedBy; prompt?: string }
	/** Stops the running step and continues it at once: a stop and a resume in one Turn. */
	| { kind: "restart"; by: ResumedBy; prompt?: string }
	/** Walks a run that is not going again from `nodeId` (`planReentry`). */
	| {
			kind: "rerun";
			by: ResumedBy;
			nodeId: string;
			stepId?: string;
			prompt?: string;
			fresh?: boolean;
	  }
	/** Stops the run now, whatever its drive does. */
	| { kind: "stop" }
	/** Ends the running step when it ran past its time budget or idle limit by `graceMs`. */
	| { kind: "overdue"; graceMs: number }
	/**
	 * Drops the checkpoint history of a run that ended without a drive here
	 * (startup recovery: the daemon died), as a drive's end drops it.
	 */
	| { kind: "prune" };

/** What a Turn did. */
export type Taken =
	/** A drive holds the run now (start, answer, wake, resume, restart, rerun). */
	| { kind: "driving" }
	/** A stop or an overdue step ended the run's open work. */
	| { kind: "halted" }
	/** The run cap is full and the caller asked to queue: the Turn comes again when a slot frees. */
	| { kind: "queued" }
	/** Nothing to do: the run no longer sleeps, is not going, or its step is within its limits. */
	| { kind: "unchanged" };

export type TakeOptions = {
	/** Default "refuse": a full run cap throws the cap message. "queue": the Turn waits for a free slot. */
	whenFull?: "refuse" | "queue";
	/** What a queued Turn runs when a slot frees. Default: the same `take` again. */
	retry?(): void;
	/** Runs first in the Turn, on the run's log: throws to refuse the Turn. */
	check?(events: readonly LoggedEvent[]): void;
};

/** What `hold` gives its function: the run's log, and whether a drive or a Turn holds a slot of it. */
export type Held = {
	row: RunRow;
	events: readonly LoggedEvent[];
	active: boolean;
};

/** A restart that came after the drive ended the run itself: there is no step left to restart. */
export class RestartTooLate extends RunRefusal {
	constructor(readonly status: RunStatus) {
		super(
			"step-ended",
			`The step ended before it could restart. The run is ${status} now.`,
		);
		this.name = "RestartTooLate";
	}
}

/** What a released runner says to a Turn: the engine hands its runs to the next one. */
export const RELEASED = "Night Shift is restarting. Try again in a moment.";
/** How long `release` waits for the Turns in flight. */
const RELEASE_WAIT_MS = 5_000;
const DEFAULT_OVERDUE_SWEEP_MS = 5_000;

type Walk = {
	/** Aborts when a person stops the run. */
	controller: AbortController;
	done: Promise<void>;
	/** The thread the drive streams; null until the drive compiled it. */
	thread: Thread | null;
};

/** "starting": reserved by the Turn that holds it, before its drive began (I3). */
type Slot = Walk | "starting";

/** What a Turn of a run did to its slot, for the end of the Turn. */
type TurnState = { freed: boolean };

export type Runner = ReturnType<typeof createRunner>;

const DRIVING: Taken = { kind: "driving" };
const HALTED: Taken = { kind: "halted" };
const QUEUED: Taken = { kind: "queued" };
const UNCHANGED: Taken = { kind: "unchanged" };

const isGoing = (status: RunStatus) =>
	status === "running" || status === "waiting" || status === "sleeping";

export function createRunner(deps: RunnerDeps) {
	const { db, log, bus } = deps;
	const open = deps.openThread ?? openThread;
	const recorders = createRecorders({ db, bus, dataDir: deps.dataDir });
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
	const closeDeps: CloseDeps = {
		db,
		log,
		bus,
		flowOf: deps.flowOf,
		calledFlowsOf: deps.calledFlowsOf,
	};
	/** Open threads by run id, kept while the run is likely to continue soon. */
	const threads = new Map<string, Thread>();
	/** Keyed by run id: the runs that walk in this process. */
	const slots = new Map<string, Slot>();
	/** Per-run queues of Turns (I1). */
	const queues = new Map<string, Promise<void>>();
	/** The Turns that began and have not ended, for `release`. */
	const inFlight = new Set<Promise<void>>();
	/** Turns a full run cap holds, by run id, in order: what each runs when a slot frees (I10). */
	const capQueue = new Map<string, () => void>();
	/** The runs whose Turn the current async context is in (I11). */
	const turnOf = new AsyncLocalStorage<ReadonlySet<string>>();
	let released = false;

	/** Runs `fn` outside any Turn: what it starts is not part of the Turn that started it. */
	const outside = <T>(fn: () => T): T => turnOf.exit(fn);

	const sleeps = createSleeps({
		now: deps.now,
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
		released = true;
		capQueue.clear();
		const held = [...slots];
		slots.clear();
		await Promise.all(
			held.map(async ([runId, slot]) => {
				// An answer that waits for its step lets go.
				bus.publish(runId, { kind: "status-changed" });
				if (slot === "starting") return;
				const settled = slot.thread?.fence.close() ?? Promise.resolve();
				slot.controller.abort();
				await settled;
			}),
		);
		await settleTurns();
		dispose();
	}

	/** Waits for the Turns in flight, up to `RELEASE_WAIT_MS`. */
	async function settleTurns(): Promise<void> {
		if (inFlight.size === 0) return;
		let timer: ReturnType<typeof setTimeout> | undefined;
		await Promise.race([
			Promise.allSettled([...inFlight]),
			new Promise<void>((resolve) => {
				timer = setTimeout(resolve, RELEASE_WAIT_MS);
				timer.unref?.();
			}),
		]);
		clearTimeout(timer);
	}

	/** The run's open thread; opened once per run, from its snapshot. */
	function threadOf(row: RunRow): Thread {
		const cached = threads.get(row.id);
		if (cached) return cached;
		const thread = open(row, threadDeps);
		threads.set(row.id, thread);
		return thread;
	}

	/** The drive that holds the run's slot, if one does. */
	function walkOf(runId: string): Walk | undefined {
		const slot = slots.get(runId);
		return slot === "starting" ? undefined : slot;
	}

	/** Throws when no Turn of `runId` may be asked for here: released (I7), or inside one (I11). */
	function refuseTurn(runId: string): void {
		if (released) throw new Error(RELEASED);
		if (turnOf.getStore()?.has(runId)) {
			throw new Error(
				`A Turn of run ${runId} cannot wait for another Turn of the same run.`,
			);
		}
	}

	/**
	 * Runs `fn` as a Turn of the run: after every earlier Turn of it has
	 * settled (I1). At its end, a slot still "starting" is freed, and a
	 * freed slot lets the cap queue go.
	 */
	function inTurn<T>(
		runId: string,
		fn: (turn: TurnState) => Promise<T>,
	): Promise<T> {
		refuseTurn(runId);
		const within = new Set([...(turnOf.getStore() ?? []), runId]);
		const previous = queues.get(runId) ?? Promise.resolve();
		const current = previous.then(() => {
			if (released) throw new Error(RELEASED);
			return turnOf.run(within, () => runTurn(runId, fn));
		});
		const tail = current.then(
			() => {},
			() => {},
		);
		queues.set(runId, tail);
		void tail.then(() => {
			if (queues.get(runId) === tail) queues.delete(runId);
		});
		return current;
	}

	async function runTurn<T>(
		runId: string,
		fn: (turn: TurnState) => Promise<T>,
	): Promise<T> {
		const turn: TurnState = { freed: false };
		const running = fn(turn);
		const settled = running.then(
			() => {},
			() => {},
		);
		inFlight.add(settled);
		try {
			return await running;
		} finally {
			inFlight.delete(settled);
			if (slots.get(runId) === "starting") {
				slots.delete(runId);
				turn.freed = true;
			}
			if (turn.freed) slotFreed(runId);
		}
	}

	/**
	 * Holds a slot for the run, in one synchronous step (I2). Throws when a
	 * drive holds it already, and on a full run cap unless `whenFull` is
	 * "queue": then the Turn waits in the cap queue, and this says false.
	 */
	function reserve(
		runId: string,
		intent: Intent,
		options: TakeOptions,
	): boolean {
		if (slots.has(runId)) {
			throw new Error(
				"This run is still running. Stop it or wait for it to end.",
			);
		}
		const runCap = deps.settings().maxConcurrentRuns;
		if (slots.size >= runCap) {
			if (options.whenFull === "queue") {
				capQueue.set(
					runId,
					options.retry ??
						(() => {
							take(runId, intent, options).catch((error) => {
								console.error(`[engine] could not take run ${runId}`, error);
							});
						}),
				);
				return false;
			}
			throw new Error(
				`The run cap is reached: ${slots.size} of ${runCap} runs are running. Stop a run or wait for one to end.`,
			);
		}
		slots.set(runId, "starting");
		return true;
	}

	/** A slot is free: the bus hears it, and every Turn the cap queue holds tries once more (I10). */
	function slotFreed(runId: string): void {
		bus.publish(runId, { kind: "status-changed" });
		if (released) return;
		const retries = [...capQueue.values()];
		capQueue.clear();
		for (const retry of retries) outside(retry);
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
	 * Takes over the Turn's reserved slot and drives the thread in the
	 * background (I4). The slot is released when the drive ends, however it
	 * ends. A released runner begins no drive (I7).
	 */
	function drive(row: RunRow, input: StreamInput): void {
		if (released) throw new Error(RELEASED);
		const runId = row.id;
		const walk: Walk = {
			controller: new AbortController(),
			done: Promise.resolve(),
			thread: null,
		};
		slots.set(runId, walk);
		bus.publish(runId, { kind: "status-changed" });
		// The drive outlives the Turn that began it: it is not part of it.
		walk.done = outside(() =>
			driveThread(row, walk, input).finally(() => {
				if (slots.get(runId) === walk) slots.delete(runId);
				slotFreed(runId);
			}),
		);
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
			// The prune comes first: once the log says the run ended, a
			// person may resume it, and the slot frees right after the end.
			await pruneThread(thread, runId);
			await endRun(thread.ctx.log, runId, ending.status, ending.reason);
		} catch (error) {
			// A stop took the run from this drive: it writes nothing more.
			if (thread?.fence.closed) return;
			console.error(`[engine] the walk of run ${runId} failed`, error);
			if (thread) await pruneThread(thread, runId);
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
	 * Drops an ended run's checkpoint history (`Thread.prune`): it keeps the
	 * latest root checkpoint and the namespaces of the tasks it still has.
	 * The history was the walk's bookkeeping and the event log is the
	 * record. What is kept is all a resume, a restart or a rerun reads
	 * (`planReentry`): a finished run's final state, or a failed or stopped
	 * run's interrupt or cut-short node with the body it parked in.
	 */
	async function pruneThread(
		thread: Thread | (() => Thread),
		runId: string,
	): Promise<void> {
		try {
			await (typeof thread === "function" ? thread() : thread).prune();
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
	 * settled; it waits on no timer (I6).
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

	/**
	 * Ends the run's open work as `cut` says (`graph/open-work.ts`): its
	 * open sessions, then its open steps from the inside out, then the run.
	 * The run's wake timer goes first. The thread stays where it is: a
	 * resume re-enters it (design rule 7), at its interrupt or at the node
	 * the drive was in.
	 */
	async function halt(row: RunRow, cut: CutShort): Promise<void> {
		sleeps.forget(row.id);
		await closeOpenWork(closeDeps, row.id, cut);
		// The drive's thread is fenced off: the run's open thread prunes.
		await pruneThread(() => threadOf(row), row.id);
	}

	/**
	 * Resolves once the run's log says step `stepId` ended, or no drive
	 * holds the run. Subscribes before the first look, so an append between
	 * the two is not missed.
	 */
	function untilStepEnded(runId: string, stepId: string): Promise<void> {
		return new Promise<void>((resolve) => {
			let settled = false;
			const unsubscribe = bus.subscribe(runId, () => void look());
			async function look(): Promise<void> {
				if (settled) return;
				const events = await log.events(runId);
				if (settled) return;
				const ended =
					deriveSteps(events).find((s) => s.id === stepId)?.endedAt !== null;
				if (ended || !slots.has(runId)) {
					settled = true;
					unsubscribe();
					resolve();
				}
			}
			void look();
		});
	}

	/**
	 * Plans a re-entry from the log and the thread's latest checkpoint
	 * (`planReentry`, which refuses a run that runs, waits or sleeps),
	 * appends the plan's `RunResumed`, and moves the thread as the plan
	 * says, on the slot the Turn holds (I5). A thread that cannot move ends
	 * the run `failed`, so the log does not say it runs.
	 */
	async function reenter(row: RunRow, request: ReentryRequest): Promise<void> {
		const runId = row.id;
		const thread = threadOf(row);
		const plan = planReentry({
			flow: deps.flowOf(row),
			events: await log.events(runId),
			thread: await thread.snapshot(),
			request,
			now: deps.now(),
		});
		if (released) throw new Error(RELEASED);
		await log.append({ type: "RunResumed", runId, payload: plan.resumed });
		try {
			if (plan.clearTasks) await thread.clearTasks();
			drive(row, inputOf(plan.entry));
		} catch (error) {
			// The next engine's recovery takes the run from here.
			if (released) throw error;
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

	/** A start: the slot first, before any await (I2), then `prepare`, then the drive. */
	async function startTurn(
		runId: string,
		intent: Extract<Intent, { kind: "start" }>,
	): Promise<Taken> {
		reserve(runId, intent, {});
		const { row, inputs, stopAt } = await intent.prepare();
		drive(row, inputOf({ kind: "start", inputs, stopAt }));
		return DRIVING;
	}

	/** An answer: the thread continues at once, so it needs a slot. A full cap leaves the Gate open. */
	async function answerTurn(
		row: RunRow,
		intent: Extract<Intent, { kind: "answer" }>,
		options: TakeOptions,
	): Promise<Taken> {
		if (!reserve(row.id, intent, options)) return QUEUED;
		const { choice, note } = intent;
		drive(
			row,
			inputOf({ kind: "resume", value: { kind: "gate", choice, note } }),
		);
		// The Gate node ends the step on the answer. The Turn ends once it
		// has, so the run no longer waits when the caller looks again (I8).
		await untilStepEnded(row.id, intent.stepId);
		return DRIVING;
	}

	/**
	 * A wake (`planWake`): `WaitEnded` and the transcript `wake`
	 * (`recordWake`), then the resume into the wait node. A timer before
	 * its time is set again.
	 */
	async function wakeTurn(
		row: RunRow,
		events: readonly LoggedEvent[],
		intent: Intent,
		how: Wake,
		options: TakeOptions,
	): Promise<Taken> {
		const runId = row.id;
		const plan = planWake(events, await threadOf(row).state(), how, deps.now());
		if (plan.kind === "not-sleeping") return UNCHANGED;
		if (plan.kind === "too-soon") {
			sleeps.schedule(runId, plan.until);
			return UNCHANGED;
		}
		// The timer goes; a wake the cap holds stays queued.
		sleeps.forget(runId);
		if (!reserve(runId, intent, options)) return QUEUED;
		await recordWake({ log, bus, recorders }, runId, plan, how);
		drive(row, inputOf({ kind: "resume", value: plan.resume }));
		return DRIVING;
	}

	/** A resume or a rerun of a run that is not going. */
	async function reenterTurn(
		row: RunRow,
		intent: Intent,
		request: ReentryRequest,
		options: TakeOptions,
	): Promise<Taken> {
		if (!reserve(row.id, intent, options)) return QUEUED;
		await reenter(row, request);
		return DRIVING;
	}

	/**
	 * A restart: the running drive is taken as a stop takes it, but its
	 * slot stays reserved for the drive that continues the run (I6). A run
	 * the log says runs but no drive in this process holds (its drive died)
	 * is closed the same way: nothing can write to it. The open work ends
	 * `stopped` (`StopRequested`, then `halt`), and the run continues as a
	 * resume continues it, with the action `restart`.
	 *
	 * When the drive ended the run itself just before its fence closed,
	 * there is nothing left to restart: throws `RestartTooLate` with the
	 * run as it ended. When it ended the step but not the run, the run goes
	 * on from the step's end on a new drive, as the old one would have
	 * (the run position finds the step done), and the restart is too late
	 * too.
	 */
	async function restartTurn(
		row: RunRow,
		intent: Extract<Intent, { kind: "restart" }>,
		turn: TurnState,
	): Promise<Taken> {
		const runId = row.id;
		const walk = walkOf(runId);
		if (walk) await takeFromDrive(runId, walk, { keepSlot: true });
		else reserve(runId, intent, {});
		// The old drive may never unwind to free its slot itself.
		turn.freed = true;
		const events = await log.events(runId);
		const status = deriveRunState(events).status;
		if (!isGoing(status)) throw new RestartTooLate(status);
		if (walk && deriveSteps(events).every((s) => s.endedAt !== null)) {
			drive(row, inputOf({ kind: "continue" }));
			throw new RestartTooLate(status);
		}
		await log.append({ type: "StopRequested", runId, payload: {} });
		await halt(row, { kind: "stopped" });
		await reenter(row, {
			kind: "resume",
			by: intent.by,
			action: "restart",
			...(intent.prompt !== undefined ? { prompt: intent.prompt } : {}),
		});
		return DRIVING;
	}

	/**
	 * A stop, whatever the drive does: takes the run from the running drive
	 * (`takeFromDrive`) and ends its open work as stopped, or closes a run
	 * that waits at a Gate or sleeps. A run the log says runs but no drive
	 * in this process holds (its drive died, or could not log its end) is
	 * closed the same way: nothing else can end it. Waits on no drive and no
	 * timer: a harness that hangs cannot hold a stop.
	 */
	async function stopTurn(row: RunRow, turn: TurnState): Promise<Taken> {
		const runId = row.id;
		const walk = walkOf(runId);
		if (walk) {
			await takeFromDrive(runId, walk);
			turn.freed = true;
		}
		const status = deriveRunState(await log.events(runId)).status;
		if (!walk && !isGoing(status)) return UNCHANGED;
		await log.append({ type: "StopRequested", runId, payload: {} });
		// A drive may have ended the run before the stop took it.
		if (!isGoing(status)) return UNCHANGED;
		await halt(row, { kind: "stopped" });
		return HALTED;
	}

	/**
	 * Ends the run's running step when it ran past its time budget or its
	 * idle limit by `graceMs` or more, as the recorded limits say
	 * (`findOverdue`): the step and the run end as the step's timer ends
	 * them, through the stop's path, so a drive that hangs writes nothing
	 * more.
	 */
	async function overdueTurn(
		row: RunRow,
		events: readonly LoggedEvent[],
		graceMs: number,
		turn: TurnState,
	): Promise<Taken> {
		const runId = row.id;
		if (deriveRunState(events).status !== "running") return UNCHANGED;
		const overdue = await findOverdue(
			events,
			{ now: deps.now(), graceMs, minuteMs: deps.minuteMs },
			{ runId, dataDir: deps.dataDir },
		);
		if (!overdue) return UNCHANGED;
		const walk = walkOf(runId);
		if (walk) {
			await takeFromDrive(runId, walk);
			turn.freed = true;
		}
		await halt(row, { kind: "overdue", ...overdue });
		return HALTED;
	}

	/** One Turn: the row and the walker (I9), the log, the caller's check, then the intent. */
	async function turnFor(
		runId: string,
		intent: Intent,
		options: TakeOptions,
		turn: TurnState,
	): Promise<Taken> {
		if (intent.kind === "start") return startTurn(runId, intent);
		const row = await getRunRow(db, runId);
		if (row.walkerId !== (await log.walkerId())) {
			// The sweep and startup recovery look at runs; they refuse nothing.
			if (intent.kind === "overdue" || intent.kind === "prune") {
				return UNCHANGED;
			}
			throw new RunRefusal("walked-elsewhere", WALKED_ELSEWHERE);
		}
		if (intent.kind === "prune") {
			// The thread opens for the prune only: a resume opens its own.
			await pruneThread(
				() => threads.get(runId) ?? open(row, threadDeps),
				runId,
			);
			return UNCHANGED;
		}
		const events = await log.events(runId);
		options.check?.(events);
		switch (intent.kind) {
			case "answer":
				return answerTurn(row, intent, options);
			case "wake":
				return wakeTurn(row, events, intent, intent, options);
			case "resume": {
				const { kind: _, ...request } = intent;
				// A sleeping run wakes now, with the person's prompt.
				if (deriveRunState(events).status === "sleeping") {
					const prompt = request.prompt;
					return wakeTurn(
						row,
						events,
						intent,
						{ early: true, ...(prompt !== undefined ? { prompt } : {}) },
						options,
					);
				}
				return reenterTurn(
					row,
					intent,
					{ kind: "resume", ...request },
					options,
				);
			}
			case "rerun": {
				const { kind: _, ...request } = intent;
				return reenterTurn(row, intent, { kind: "rerun", ...request }, options);
			}
			case "restart":
				return restartTurn(row, intent, turn);
			case "stop":
				return stopTurn(row, turn);
			case "overdue":
				return overdueTurn(row, events, intent.graceMs, turn);
		}
	}

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
		if (
			walk &&
			(intent.kind === "wake" ||
				(intent.kind === "resume" &&
					deriveRunState(await log.events(runId)).status === "sleeping"))
		) {
			await walk.done;
		}
		return inTurn(runId, (turn) => turnFor(runId, intent, options, turn));
	}

	/**
	 * A Turn that drives nothing: `fn` sees the run's row, its log, and
	 * whether a drive or a Turn holds a slot of it, and no other Turn of the
	 * run comes in between. For an action that writes one fact (a stop
	 * after the step, a move).
	 */
	async function hold<T>(
		runId: string,
		fn: (held: Held) => Promise<T>,
	): Promise<T> {
		return inTurn(runId, async () => {
			const row = await getRunRow(db, runId);
			if (row.walkerId !== (await log.walkerId())) {
				throw new RunRefusal("walked-elsewhere", WALKED_ELSEWHERE);
			}
			return fn({
				row,
				events: await log.events(runId),
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
		if (released) return;
		for (const runId of slots.keys()) {
			if (checking.has(runId)) continue;
			checking.add(runId);
			take(runId, { kind: "overdue", graceMs: deps.minuteMs })
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
		/** A new daemon's wake timer from the log, or a moved-in run's (`graph/sleep.ts`). */
		restore: (runId: string, events: readonly LoggedEvent[]): void =>
			sleeps.restore(runId, events),
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
