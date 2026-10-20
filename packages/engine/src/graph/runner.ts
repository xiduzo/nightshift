import { Command, END } from "@langchain/langgraph";
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
	type EnginePayloads,
	getRunRow,
	type LoggedEvent,
	type RunBus,
	type RunEnding,
	type RunLog,
	type RunRow,
	type RunStatus,
} from "../log";
import {
	type DerivedStep,
	deriveRunState,
	deriveSessions,
	deriveSteps,
	withEnclosing,
} from "../read";
import { compileFlow } from "./compile";
import { createRecorders, messageOf, type StepContext } from "./context";
import { findOverdue, type Overdue } from "./deadlines";
import {
	createFence,
	type Fence,
	FencedError,
	FencedSaver,
	fencedLog,
} from "./fence";
import { kindOf, kindOfType } from "./node-kinds";
import { loggedVisits, reenteredNode, reentryUpdate } from "./resume-point";
import { createSleeps } from "./sleep";
import type {
	Ended,
	Parked,
	ResumeValue,
	RunEvent,
	RunStateUpdate,
	RunStateValues,
} from "./state";

/**
 * The per-run driver: every run is one LangGraph thread (thread id = run
 * id) on a graph compiled from the run's flow snapshot (design rule 1).
 * The runner streams the graph, reacts to its interrupts, appends
 * `RunEnded`, and owns what the walk owned around the steps: the slots and
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
 *   resume-point.ts, next to the rule the nodes re-enter by).
 * - Only the root namespace's `__interrupt__` counts (one interrupt repeats
 *   once per level). A `wait` schedules the wake timer with the sleep
 *   module (`WaitStarted` is in the log already); a `gate` needs nothing
 *   (the Gate node logged `GateOpened`); `parked` appends `RunEnded` with
 *   its status and reason.
 * - A stream that ends with `state.ended` set appends `RunEnded finished`
 *   and prunes the thread to its latest checkpoint (the log is the
 *   record); one that throws appends `RunEnded failed` with `The engine
 *   failed: …`.
 * - The custom stream chunks (`RunEvent`) are the runner's bookkeeping:
 *   transcript entries reach the bus from the recorder already.
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

/** Where a run's thread is, for the engine's resume mapping (design rule 9). */
export type ThreadState =
	/** The thread sits at an interrupt: a wait, a Gate, or a parked step. */
	| { kind: "interrupted"; value: Parked }
	/** A node is pending without an interrupt: the daemon died, or the engine failed, while it ran. */
	| { kind: "pending"; next: string[] }
	/** The thread reached END. */
	| { kind: "ended"; ended: Ended | null }
	/** No checkpoint yet: the thread never ran. */
	| { kind: "fresh" };

type Walk = {
	/** Aborts when a person stops the run. */
	controller: AbortController;
	done: Promise<void>;
	/** The thread the drive streams; null until the drive compiled it. */
	thread: Thread | null;
};

/** A slot is reserved before any await, so two calls cannot both pass the cap. */
type Slot = Walk | "starting";

type Thread = {
	ctx: StepContext;
	graph: ReturnType<ReturnType<typeof compileFlow>["compile"]>;
	/** The controller of the current drive; a new one per drive. */
	controller: AbortController;
	/**
	 * Every write of the thread's drives goes through it: the log in `ctx`
	 * and `saver`. A stop closes it and drops the thread from the cache, so
	 * the next drive of the run compiles a new thread with a new fence.
	 */
	fence: Fence;
	saver: FencedSaver;
};

type StreamInput = Parameters<Thread["graph"]["stream"]>[0];

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
	/** Compiled graphs by run id, kept while the run is likely to continue soon. */
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
			resume: (row, value) => drive(row, new Command({ resume: value })),
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

	const configOf = (runId: string) => ({
		configurable: { thread_id: runId },
	});

	/** The run's compiled graph, from its snapshot; compiled once per run. */
	function threadOf(row: RunRow): Thread {
		const cached = threads.get(row.id);
		if (cached) return cached;
		const flow = deps.flowOf(row);
		const fence = createFence(row.id);
		const ctx: StepContext = {
			db,
			run: row,
			flow,
			flowName: row.flowName ?? row.title,
			flows: deps.calledFlowsOf(row),
			// Resolved at each use: the settings may change while the thread is cached.
			policy: () => deps.policyFor(flow),
			log: fencedLog(log, fence),
			bus,
			recorder: (stepId, path) => recorders.open(row.id, stepId, path),
			deviceFor: deps.deviceFor,
			deviceById: deps.deviceById,
			signal: () => thread.controller.signal,
			now: deps.now,
			minuteMs: deps.minuteMs,
			dataDir: deps.dataDir,
			settings: deps.settings,
			kindOf,
		};
		const saver = new FencedSaver(db, fence);
		const thread: Thread = {
			ctx,
			graph: compileFlow(flow, ctx).compile({ checkpointer: saver }),
			controller: new AbortController(),
			fence,
			saver,
		};
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
	 * Streams the thread and records how the drive ended. A drive whose
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
			thread.controller = walk.controller;
			const stream = await thread.graph.stream(input, {
				...configOf(runId),
				streamMode: ["updates", "custom"],
				subgraphs: true,
				durability: "sync",
				// Every node visit, park, wait and Call element is one
				// super-step, and LangGraph's default stops a drive at 25. The
				// step cap is the walk's own (`beginStep`, from the log), so the
				// graph's limit is out of the way. Bodies inherit it through the
				// config `runBody` passes on.
				recursionLimit: Number.MAX_SAFE_INTEGER,
			});
			let parked: Parked | null = null;
			for await (const chunk of stream) {
				const [namespace, mode, data] = chunk as [string[], string, unknown];
				if (mode === "custom") {
					onCustom(runId, data as RunEvent);
					continue;
				}
				if (namespace.length > 0) continue;
				const interrupts = (data as Record<string, unknown>).__interrupt__ as
					| { value: Parked }[]
					| undefined;
				const first = interrupts?.[0];
				if (first) parked = first.value;
			}
			if (thread.fence.closed) return;
			if (parked) {
				await onInterrupt(thread, runId, parked);
				return;
			}
			const snapshot = await thread.graph.getState(configOf(runId));
			const ended = (snapshot.values as RunStateValues).ended;
			if (!ended) {
				throw new Error("The graph stopped without an end or an interrupt.");
			}
			if (thread.fence.closed) return;
			dropThread(runId, thread);
			await endRun(thread.ctx.log, runId, "finished", ended.reason);
			await pruneThread(thread, runId);
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
			await thread.saver.pruneThread(runId);
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
	 * never gets here: the stop closed the parked step itself.
	 */
	async function onInterrupt(
		thread: Thread,
		runId: string,
		parked: Parked,
	): Promise<void> {
		switch (parked.kind) {
			case "wait":
				// A wait with no time (a signal with no timeout) has no timer.
				if (parked.until !== null) sleeps.schedule(runId, parked.until);
				return;
			case "gate":
				return;
			case "parked":
				dropThread(runId, thread);
				await endRun(thread.ctx.log, runId, parked.status, parked.reason);
				return;
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

	/**
	 * Ends the run's open work: its open sessions, then its open steps from
	 * the inside out (a running step, an open Gate or a sleeping step, and
	 * the Call steps around them), then the run. The thread stays where it
	 * is: a resume re-enters it (design rule 7), at its interrupt or at the
	 * node the drive was in.
	 *
	 * - `stopped` (a person stopped the run): every step ends `stopped` with
	 *   its kind's outputs (`stoppedOutputs`), the run `stopped`.
	 * - `overdue` (a step ran past its time budget or idle limit and its
	 *   timer did not end it): that step ends `error` with the timer's
	 *   message, the steps around it and the run fail with the reason a
	 *   failed step gives (`route`). The sessions end as the timer's abort
	 *   ends them: `failed`, aborted.
	 */
	async function closeOpenWork(
		runId: string,
		halt: { kind: "stopped" } | ({ kind: "overdue" } & Overdue),
	): Promise<void> {
		const reason =
			halt.kind === "overdue"
				? `Node "${halt.nodeId}" failed: ${halt.error}`
				: null;
		const events = await log.events(runId);
		const steps = deriveSteps(events);
		sleeps.forget(runId);
		for (const session of deriveSessions(events)) {
			if (session.ending !== null) continue;
			const ending: EnginePayloads["SessionEnded"] = {
				outcome: halt.kind === "stopped" ? "stopped" : "failed",
				error: "The session was aborted.",
				errorKind: "aborted",
				usage: null,
				costUsd: null,
				resetAt: null,
			};
			await log.append({
				type: "SessionEnded",
				runId,
				stepId: session.stepId,
				sessionId: session.id,
				payload: ending,
			});
		}
		const open = steps
			.filter((s) => s.endedAt === null)
			.sort((a, b) => b.startSeq - a.startSeq);
		if (open.length > 0) {
			const row = await getRunRow(db, runId);
			const flow = deps.flowOf(row);
			const flows = deps.calledFlowsOf(row);
			for (const step of open) {
				// The kind says what a stopped step ends with; the node is the
				// logged kind's, or missing when the snapshot has no node for it.
				const node = nodesOf(flow, flows, withEnclosing(steps, step.id)).get(
					step.id,
				);
				const outputs = kindOfType(step.nodeType).stoppedOutputs(step, node);
				const payload: EnginePayloads["StepEnded"] =
					halt.kind === "stopped"
						? { outcome: "stopped", outputs, error: null }
						: {
								outcome: "error",
								outputs: { ...outputs, outcome: "error" },
								error: step.id === halt.stepId ? halt.error : reason,
							};
				await log.append({
					type: "StepEnded",
					runId,
					stepId: step.id,
					payload,
				});
				bus.publish(runId, { kind: "step-changed", stepId: step.id });
			}
		}
		await endRun(
			log,
			runId,
			halt.kind === "stopped" ? "stopped" : "failed",
			reason,
		);
		bus.publish(runId, { kind: "status-changed" });
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
	async function threadState(row: RunRow): Promise<ThreadState> {
		const thread = threadOf(row);
		const snapshot = await thread.graph.getState(configOf(row.id));
		const interrupt = snapshot.tasks
			.flatMap((task) => task.interrupts)
			.find((i) => i.value !== undefined);
		if (interrupt) {
			return { kind: "interrupted", value: interrupt.value as Parked };
		}
		if (snapshot.next.length > 0) {
			return { kind: "pending", next: [...snapshot.next] };
		}
		if (snapshot.config?.configurable?.checkpoint_id === undefined) {
			return { kind: "fresh" };
		}
		return {
			kind: "ended",
			ended: (snapshot.values as Partial<RunStateValues>).ended ?? null,
		};
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
			drive(row, { inputs, stopAt });
		},
		/**
		 * Re-runs the node the thread is pending at (a daemon death or an
		 * engine failure). `update` writes state first (a cleared stop time).
		 */
		continueRun(row: RunRow, update?: RunStateUpdate): void {
			drive(row, update ? new Command({ update }) : null);
		},
		/** Answers the interrupt the thread sits at; `update` writes state before the node continues. */
		resume(row: RunRow, value: ResumeValue, update?: RunStateUpdate): void {
			drive(row, new Command({ resume: value, ...(update ? { update } : {}) }));
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
			const snapshot = await thread.graph.getState(configOf(row.id));
			let seed: RunStateUpdate;
			if (snapshot.config?.configurable?.checkpoint_id === undefined) {
				seed = reentryUpdate(thread.ctx.flow, events);
			} else {
				const reentered = reenteredNode(events);
				const visits = (snapshot.values as RunStateValues).visits;
				const committed = reentered ? (visits[reentered] ?? 0) : 0;
				seed = {
					ended: null,
					pending: null,
					...(reentered && committed > 0
						? { visits: { [reentered]: committed - 1 } }
						: {}),
				};
			}
			// The node names are the flow's, which the graph's type cannot know.
			const jump = new Command({
				goto: nodeId,
				update: { ...seed, ...update },
			}) as unknown as StreamInput;
			drive(row, jump);
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
			const config = configOf(row.id);
			const snapshot = await thread.graph.getState(config);
			let seed: RunStateUpdate;
			if (snapshot.config?.configurable?.checkpoint_id === undefined) {
				seed = reentryUpdate(thread.ctx.flow, events, null);
			} else {
				if (snapshot.tasks.length > 0) {
					await thread.graph.updateState(config, null, END);
				}
				const { loops } = snapshot.values as RunStateValues;
				seed = {
					ended: null,
					pending: null,
					visits: loggedVisits(thread.ctx.flow, events, null),
					loops: Object.fromEntries(
						Object.keys(loops ?? {}).map((id) => [id, null]),
					),
				};
			}
			const jump = new Command({
				goto: nodeId,
				update: { ...seed, ...update },
			}) as unknown as StreamInput;
			drive(row, jump);
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
		stop,
		restart,
		release,
		endIfOverdue,
		endOverdueSteps,
		dispose,
	};
}

/**
 * The node of each step in a chain of calling steps (inside out, as
 * `withEnclosing` gives it): the outermost is in the run's flow, each inner
 * one in the flow its caller's Call node names. Stops at a node the
 * snapshot does not have.
 */
function nodesOf(
	flow: Flow,
	flows: Record<string, Flow>,
	chain: readonly DerivedStep[],
): Map<string, FlowNode> {
	const nodes = new Map<string, FlowNode>();
	let current: Flow | undefined = flow;
	for (const step of [...chain].reverse()) {
		const node: FlowNode | undefined = current?.nodes.find(
			(n) => n.id === step.nodeId,
		);
		if (!node) break;
		nodes.set(step.id, node);
		current = node.type === "call" ? flows[node.flow] : undefined;
	}
	return nodes;
}
