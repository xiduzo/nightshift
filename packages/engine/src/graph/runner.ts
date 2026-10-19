import { Command } from "@langchain/langgraph";
import type { Database } from "@nightshift/db";
import type {
	Flow,
	FlowNode,
	JsonValue,
	ResolvedPolicy,
} from "@nightshift/flows";

import type { RunBus } from "../bus";
import type { Device } from "../device/types";
import {
	type DerivedStep,
	deriveRunState,
	type LoggedEvent,
	parkedSteps,
	type RunEnding,
} from "../events";
import type { RunLog } from "../run-log";
import type { RunSettings } from "../settings";
import { saverFor } from "./checkpointer";
import { compileFlow } from "./compile";
import {
	createRecorders,
	getRunRow,
	messageOf,
	type RunRow,
	type StepContext,
} from "./context";
import { kindOfType } from "./node-kinds";
import { reenteredNode, reentryUpdate } from "./resume-point";
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
 * the run cap, the per-run `exclusive` queue, a stop with its grace, and
 * `closeParked`. The wake timers and the wake of a sleeping run are the
 * sleep module's (`sleeps`, `graph/sleep.ts`), given the runner's thread
 * seam.
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
};

/** A slot is reserved before any await, so two calls cannot both pass the cap. */
type Slot = Walk | "starting";

type Thread = {
	ctx: StepContext;
	graph: ReturnType<ReturnType<typeof compileFlow>["compile"]>;
	/** The controller of the current drive; a new one per drive. */
	controller: AbortController;
};

type StreamInput = Parameters<Thread["graph"]["stream"]>[0];

export type Runner = ReturnType<typeof createRunner>;

export function createRunner(deps: RunnerDeps) {
	const { db, log, bus } = deps;
	const saver = saverFor(db);
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

	const configOf = (runId: string) => ({
		configurable: { thread_id: runId },
	});

	/** The run's compiled graph, from its snapshot; compiled once per run. */
	function threadOf(row: RunRow): Thread {
		const cached = threads.get(row.id);
		if (cached) return cached;
		const flow = deps.flowOf(row);
		const ctx: StepContext = {
			db,
			run: row,
			flow,
			flowName: row.flowName ?? row.title,
			flows: deps.calledFlowsOf(row),
			// Resolved at each use: the settings may change while the thread is cached.
			policy: () => deps.policyFor(flow),
			log,
			bus,
			recorder: (stepId, path) => recorders.open(row.id, stepId, path),
			deviceFor: deps.deviceFor,
			deviceById: deps.deviceById,
			signal: () => thread.controller.signal,
			now: deps.now,
			minuteMs: deps.minuteMs,
			dataDir: deps.dataDir,
			settings: deps.settings,
		};
		const thread: Thread = {
			ctx,
			graph: compileFlow(flow, ctx).compile({ checkpointer: saver }),
			controller: new AbortController(),
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

	async function endRun(
		runId: string,
		status: RunEnding,
		reason: string | null,
	): Promise<void> {
		try {
			await log.append({
				type: "RunEnded",
				runId,
				payload: { status, reason },
			});
		} catch (error) {
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
		};
		slots.set(runId, walk);
		bus.publish(runId, { kind: "status-changed" });
		walk.done = driveThread(row, walk.controller, input).finally(() => {
			if (slots.get(runId) === walk) slots.delete(runId);
			bus.publish(runId, { kind: "status-changed" });
			sleeps.drain();
			deps.onSlotFreed?.();
		});
	}

	async function driveThread(
		row: RunRow,
		controller: AbortController,
		input: StreamInput,
	): Promise<void> {
		const runId = row.id;
		try {
			const thread = threadOf(row);
			thread.controller = controller;
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
			if (parked) {
				await onInterrupt(runId, parked, controller.signal);
				return;
			}
			const snapshot = await thread.graph.getState(configOf(runId));
			const ended = (snapshot.values as RunStateValues).ended;
			if (!ended) {
				throw new Error("The graph stopped without an end or an interrupt.");
			}
			threads.delete(runId);
			await endRun(runId, "finished", ended.reason);
			await pruneThread(runId);
		} catch (error) {
			console.error(`[engine] the walk of run ${runId} failed`, error);
			await endRun(runId, "failed", `The engine failed: ${messageOf(error)}`);
		}
	}

	/**
	 * Keeps a finished run's latest checkpoint and deletes the older ones
	 * and the body namespaces. The history was the walk's bookkeeping and
	 * the event log is the record; the final state is what `resumeRun` of a
	 * finished run re-enters on (`reenter`).
	 */
	async function pruneThread(runId: string): Promise<void> {
		try {
			await saver.pruneThread(runId);
		} catch (error) {
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
	 * wait began or the Gate opened closes the parked step at once, as the
	 * walk did on `paused`.
	 */
	async function onInterrupt(
		runId: string,
		parked: Parked,
		signal: AbortSignal,
	): Promise<void> {
		switch (parked.kind) {
			case "wait":
				// A wait with no time (a signal with no timeout) has no timer.
				if (parked.until !== null) sleeps.schedule(runId, parked.until);
				if (signal.aborted) await closeParked(runId);
				return;
			case "gate":
				if (signal.aborted) await closeParked(runId);
				return;
			case "parked":
				threads.delete(runId);
				await endRun(runId, parked.status, parked.reason);
				return;
		}
	}

	/**
	 * Closes the step the run is parked at (an open Gate or a sleeping step)
	 * and the Call steps around it without an answer, and
	 * ends the run as `stopped`. The thread stays at its interrupt: a resume
	 * re-enters it (design rule 7). False when the run is not parked.
	 */
	async function closeParked(runId: string): Promise<boolean> {
		const status = "stopped";
		const parked = parkedSteps(await log.events(runId));
		if (parked.length === 0) return false;
		sleeps.forget(runId);
		const row = await getRunRow(db, runId);
		const nodes = nodesOf(deps.flowOf(row), deps.calledFlowsOf(row), parked);
		for (const open of parked) {
			// The kind says what a stopped step ends with; the node is the
			// logged kind's, or missing when the snapshot has no node for it.
			const outputs = kindOfType(open.nodeType).stoppedOutputs(
				open,
				nodes.get(open.id),
			);
			await log.append({
				type: "StepEnded",
				runId,
				stepId: open.id,
				payload: { outcome: status, outputs, error: null },
			});
			bus.publish(runId, { kind: "step-changed", stepId: open.id });
		}
		await endRun(runId, status, null);
		bus.publish(runId, { kind: "status-changed" });
		return true;
	}

	/**
	 * Stops the run now: aborts the running drive (the step ends `stopped`
	 * and parks), or closes a run that waits at a Gate or sleeps. No-op
	 * when nothing runs, waits or sleeps.
	 */
	async function stop(runId: string): Promise<void> {
		await exclusive(runId, async () => {
			const slot = slots.get(runId);
			if (slot === "starting") return;
			let requested = false;
			if (slot) {
				if (!slot.controller.signal.aborted) {
					await log.append({ type: "StopRequested", runId, payload: {} });
					requested = true;
					slot.controller.abort();
				}
				await slot.done;
			}
			// A run that waits at a Gate or sleeps, or reached one while it stopped.
			const status = deriveRunState(await log.events(runId)).status;
			if (status !== "waiting" && status !== "sleeping") return;
			if (!requested) {
				await log.append({ type: "StopRequested", runId, payload: {} });
			}
			await closeParked(runId);
		});
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
		threadState,
		/** The sleeping runs: `wake(runId, how)`, `restore(runId, events)` (`graph/sleep.ts`). */
		sleeps,
		stop,
		closeParked,
		dispose,
	};
}

/**
 * The node of each step in a chain of calling steps (inside out, as
 * `parkedSteps` gives it): the outermost is in the run's flow, each inner
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
