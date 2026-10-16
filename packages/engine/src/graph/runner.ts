import { Command } from "@langchain/langgraph";
import type {
	AgentHarness,
	Decider,
	GithubItemsInput,
	HarnessName,
} from "@nightshift/agents/types";
import type { Database } from "@nightshift/db";
import type {
	AgentNode,
	Flow,
	JsonValue,
	ListItem,
	ResolvedPolicy,
} from "@nightshift/flows";

import type { RunBus } from "../bus";
import {
	countVisits,
	deriveInputs,
	deriveNodeOutputs,
	deriveRunState,
	deriveSleep,
	deriveSteps,
	deriveTraversals,
	type LoggedEvent,
	parkedSteps,
	type RunEnding,
	type StepOutputs,
	scopeKey,
} from "../events";
import { forEachOutputs } from "../foreach";
import type { McpExpansion } from "../mcp";
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
 * the run cap, the per-run `exclusive` queue, the wake timers of sleeping
 * runs, a stop with its grace, and `closeParked`.
 *
 * - `start` streams `{ inputs }`; `continueRun` streams `null` (the node a
 *   dead daemon left pending re-runs, rule 5); `resume` streams
 *   `Command({ resume })` into the interrupt the thread sits at; `reenter`
 *   jumps to a node of a thread that ended or never started.
 * - Only the root namespace's `__interrupt__` counts (one interrupt repeats
 *   once per level). A `wait` schedules the wake timer (`WaitStarted` is in
 *   the log already); a `gate` needs nothing (the Gate node logged
 *   `GateOpened`); `parked` appends `RunEnded` with its status and reason.
 * - A stream that ends with `state.ended` set appends `RunEnded finished`
 *   and deletes the thread's checkpoints (the log is the record); one that
 *   throws appends `RunEnded failed` with `The engine failed: …`.
 * - The custom stream chunks (`RunEvent`) are the runner's bookkeeping:
 *   transcript entries reach the bus from the recorder already.
 */

/** setTimeout cannot wait longer; a longer wait checks the clock and waits again. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * The state a thread without a usable checkpoint is re-entered with, from
 * the log: the inputs, the committed visits of every top-level node, the
 * node outputs for templates and the edge counts. Without it every node
 * with a step in the log looks uncommitted (`uncommittedStep`), so a
 * Subflow or For Each later in the flow would reopen a finished step,
 * `{{node.output}}` would render empty and edge `max` counts would start
 * over. Bodies get fresh namespaces and read their scope from the log.
 *
 * One step stays uncommitted on purpose: the last top-level step, when the
 * walk did not move on from it (no later top-level `EdgeTaken`). It is the
 * step the resume targets (`resumeTarget` in engine.ts picks the same), so
 * the node reopens it as the old walk did: an Agent continues its harness
 * session with the resume prompt, a Subflow or For Each goes on inside it.
 */
export function reentryUpdate(
	flow: Flow,
	events: readonly LoggedEvent[],
): RunStateUpdate {
	const last = deriveSteps(events).findLast((s) => scopeKey(s.scope) === "");
	const movedOn =
		last !== undefined &&
		events.some(
			(e) =>
				e.type === "EdgeTaken" &&
				scopeKey(e.payload.scope) === "" &&
				e.seq > last.startSeq,
		);
	const reentered = last && !movedOn ? last.nodeId : null;
	const visits: Record<string, number> = {};
	for (const node of flow.nodes) {
		const count =
			countVisits(events, node.id, "") - (node.id === reentered ? 1 : 0);
		if (count > 0) visits[node.id] = count;
	}
	return {
		inputs: deriveInputs(events),
		visits,
		nodes: deriveNodeOutputs(events, ""),
		traversals: deriveTraversals(events, ""),
		ended: null,
		pending: null,
	};
}

export type RunnerDeps = {
	db: Database;
	log: RunLog;
	bus: RunBus;
	dataDir: string;
	now(): number;
	minuteMs: number;
	settings(): RunSettings;
	harnessFor(name: HarnessName): AgentHarness | undefined;
	decider?: Decider;
	readGithubItems?: (input: GithubItemsInput) => Promise<ListItem[]>;
	mcpServersFor(
		node: Pick<AgentNode, "connections" | "mcpServers">,
	): Promise<McpExpansion>;
	/** The run's flow snapshot and its called flows, parsed. */
	flowOf(row: RunRow): Flow;
	calledFlowsOf(row: RunRow): Record<string, Flow>;
	/** The flow's own policy numbers, else the daemon's settings. */
	policyFor(flow: Flow): ResolvedPolicy;
	/** Aborting it clears the wake timers and ignores later wakes: the daemon dies. */
	signal?: AbortSignal;
	/** Called after a drive ended and its slot freed, once the pending wakes drained. */
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
	/** Timers that end the waits of sleeping runs, by run id. */
	const wakeTimers = new Map<string, ReturnType<typeof setTimeout>>();
	/** Sleeping runs whose wait ended while the run cap was full. */
	const pendingWakes = new Set<string>();
	let disposed = false;

	function dispose(): void {
		disposed = true;
		for (const timer of wakeTimers.values()) clearTimeout(timer);
		wakeTimers.clear();
		pendingWakes.clear();
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
			harnessFor: deps.harnessFor,
			...(deps.decider ? { decider: deps.decider } : {}),
			...(deps.readGithubItems
				? { readGithubItems: deps.readGithubItems }
				: {}),
			mcpServersFor: deps.mcpServersFor,
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
			drainPendingWakes();
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
				// Every node visit, park, wait and For Each element is one
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
	 * Deletes a finished run's checkpoints and pending writes. They were the
	 * walk's bookkeeping; the event log is the record. A finished run is
	 * never resumed through its thread: `resumeRun` of one finds the thread
	 * `fresh` and re-enters it from the log (`reenter`).
	 */
	async function pruneThread(runId: string): Promise<void> {
		try {
			await saver.deleteThread(runId);
		} catch (error) {
			console.error(
				`[engine] could not delete the checkpoints of run ${runId}`,
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
				scheduleWake(runId, parked.until);
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

	function clearWakeTimer(runId: string): void {
		const timer = wakeTimers.get(runId);
		if (timer !== undefined) clearTimeout(timer);
		wakeTimers.delete(runId);
	}

	function scheduleWake(runId: string, until: number): void {
		clearWakeTimer(runId);
		if (disposed) return;
		const delay = Math.min(Math.max(0, until - deps.now()), MAX_TIMER_MS);
		const timer = setTimeout(() => {
			wakeTimers.delete(runId);
			wake(runId, { early: false }).catch((error) => {
				console.error(`[engine] could not wake run ${runId}`, error);
			});
		}, delay);
		timer.unref?.();
		wakeTimers.set(runId, timer);
	}

	function drainPendingWakes(): void {
		if (disposed) return;
		for (const runId of [...pendingWakes]) {
			pendingWakes.delete(runId);
			wake(runId, { early: false }).catch((error) => {
				console.error(`[engine] could not wake run ${runId}`, error);
			});
		}
	}

	/**
	 * Ends the wait of a sleeping run and continues the step that waited:
	 * `WaitEnded`, the transcript `wake` entry, then `Command({ resume:
	 * { kind: "wake" } })` into the wait node. `early`: a person resumed the
	 * run before its time (a full run cap then fails); otherwise a full cap
	 * queues the wake until a slot frees.
	 */
	async function wake(
		runId: string,
		input: { early: boolean; prompt?: string },
	): Promise<void> {
		if (disposed) return;
		// The drive that began the wait may still be unwinding.
		const slot = slots.get(runId);
		if (slot && slot !== "starting") await slot.done;
		await exclusive(runId, async () => {
			if (disposed) return;
			const events = await log.events(runId);
			const sleep = deriveSleep(events);
			if (!sleep || deriveRunState(events).status !== "sleeping") return;
			if (!input.early && deps.now() < sleep.until) {
				scheduleWake(runId, sleep.until);
				return;
			}
			clearWakeTimer(runId);
			try {
				reserveSlot(runId);
			} catch (error) {
				if (input.early) throw error;
				pendingWakes.add(runId);
				return;
			}
			try {
				const row = await getRunRow(db, runId);
				const waiting = deriveSteps(events).find((s) => s.id === sleep.stepId);
				if (!waiting) throw new Error(`Step not found: ${sleep.stepId}`);
				await log.append({
					type: "WaitEnded",
					runId,
					stepId: waiting.id,
					payload: { early: input.early },
				});
				const recorder = await recorders.open(
					runId,
					waiting.id,
					waiting.transcriptPath,
				);
				try {
					recorder.record(null, { type: "wake" });
				} finally {
					recorder.close();
				}
				bus.publish(runId, { kind: "step-changed", stepId: waiting.id });
				drive(
					row,
					new Command({
						resume: {
							kind: "wake",
							early: input.early,
							...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
						} satisfies ResumeValue,
					}),
				);
			} finally {
				releaseStartingSlot(runId);
			}
		});
	}

	/**
	 * Closes the step the run is parked at (an open Gate or a sleeping step)
	 * and the For Each and Subflow steps around it without an answer, and
	 * ends the run as `stopped`. The thread stays at its interrupt: a resume
	 * re-enters it (design rule 7). False when the run is not parked.
	 */
	async function closeParked(runId: string): Promise<boolean> {
		const status = "stopped";
		const parked = parkedSteps(await log.events(runId));
		if (parked.length === 0) return false;
		clearWakeTimer(runId);
		pendingWakes.delete(runId);
		for (const open of parked) {
			const outputs: StepOutputs =
				open.nodeType === "foreach"
					? forEachOutputs({
							items: open.items,
							visit: open.visit,
							outcome: status,
							waitingCount: 0,
						})
					: open.nodeType === "gate"
						? { outcome: status, note: "", visit: open.visit }
						: open.nodeType === "subflow"
							? { outcome: status, ended: "", visit: open.visit }
							: { ...open.outputs, outcome: status };
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
		/** Starts the thread at the flow's start node with the run's inputs. Takes over a reserved slot. */
		start(row: RunRow, inputs: Record<string, JsonValue>): void {
			drive(row, { inputs });
		},
		/** Re-runs the node the thread is pending at (a daemon death or an engine failure). */
		continueRun(row: RunRow): void {
			drive(row, null);
		},
		/** Answers the interrupt the thread sits at. */
		resume(row: RunRow, value: ResumeValue): void {
			drive(row, new Command({ resume: value }));
		},
		/**
		 * Jumps to a top-level node of a thread that reached END or never ran
		 * (a run from before this engine, or a finished one whose checkpoints
		 * were pruned), with the state seeded from the log (`reentryUpdate`).
		 */
		reenter(row: RunRow, nodeId: string, events: readonly LoggedEvent[]): void {
			const thread = threadOf(row);
			// The node names are the flow's, which the graph's type cannot know.
			const jump = new Command({
				goto: nodeId,
				update: reentryUpdate(thread.ctx.flow, events),
			}) as unknown as StreamInput;
			drive(row, jump);
		},
		threadState,
		wake,
		stop,
		closeParked,
		scheduleWake,
		clearWakeTimer,
		drainPendingWakes,
		dispose,
	};
}
