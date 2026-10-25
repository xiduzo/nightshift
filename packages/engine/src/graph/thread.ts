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
import type { RunBus, RunEnding, RunLog, RunRow } from "../log";
import { compileFlow } from "./compile";
import type { createRecorders, StepContext } from "./context";
import { createFence, type Fence, FencedSaver, fencedLog } from "./fence";
import { kindOf } from "./node-kinds";
import type {
	Ended,
	Parked,
	ResumeValue,
	RunEvent,
	RunStateUpdate,
	RunStateValues,
} from "./state";

/**
 * One Run's Thread: the graph compiled from the run's flow snapshot, the
 * StepContext its nodes get, its fence and its checkpoint saver, and the
 * stream loop that drives it. The runner opens one per run and keeps it
 * while the run is likely to go on soon. The node tests open theirs the
 * same way (`testing/graph.ts`), so they drive the loop production drives.
 *
 * - `openThread` is the one StepContext builder of the package. Every
 *   write of the thread goes through its fence: the log in `ctx` and the
 *   saver (`fence.ts`).
 * - `driveGraph` is the one stream loop. It streams with
 *   `durability: "sync"` and no recursion limit (the step cap is the
 *   walk's own, from the log). Only the root namespace's `__interrupt__`
 *   counts: one interrupt repeats once per level. A drive ends parked at
 *   an interrupt, ended at END with `ended` set, or fenced off by a stop.
 *   A graph that stops without either throws.
 * - `endingOf` says what the runner appends for an outcome, and
 *   `inputOf` builds the LangGraph input of an entry into the thread.
 */

/** The graph of one run, compiled with its checkpoint saver. */
export type RunGraph = ReturnType<ReturnType<typeof compileFlow>["compile"]>;

/** What one drive streams into the graph: inputs, `null`, or a `Command`. */
export type StreamInput = Parameters<RunGraph["stream"]>[0];

/** What a Thread needs to build its StepContext and its saver. */
export type ThreadDeps = {
	db: Database;
	/** The run log. The Thread fences it: `ctx.log` is the fenced one. */
	log: RunLog;
	bus: RunBus;
	/** The transcript recorders, shared by every thread of the runner. */
	recorders: Pick<ReturnType<typeof createRecorders>, "open">;
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
};

/** Where a run's thread is, for the engine's resume mapping (design rule 9). */
export type ThreadState =
	/** The thread sits at an interrupt: a wait, a Gate, or a parked step. */
	| { kind: "interrupted"; value: Parked }
	/**
	 * A node is pending without an interrupt: the daemon died, a stop came,
	 * or the engine failed, while it ran or before its super-step was
	 * checkpointed.
	 */
	| { kind: "pending"; next: string[] }
	/** The thread reached END. */
	| { kind: "ended"; ended: Ended | null }
	/** No checkpoint yet: the thread never ran. */
	| { kind: "fresh" };

/** The thread's latest checkpoint, as a re-entry reads it. */
export type ThreadSnapshot = {
	state: ThreadState;
	values: Partial<RunStateValues>;
	/** False for a thread that never ran, or a run from before this engine. */
	hasCheckpoint: boolean;
	/** The thread still has a task: an interrupt, or a node a stop or a death cut short. */
	hasTasks: boolean;
};

/** How one drive ended. */
export type DriveOutcome =
	/**
	 * The root's interrupt ended the drive. `parked` is the one the runner
	 * reacts to (the last); `interrupts` lists every root interrupt, in order.
	 */
	| { kind: "parked"; parked: Parked; interrupts: Parked[] }
	/** The graph reached END with `ended` set. */
	| { kind: "ended"; ended: Ended }
	/** A stop closed the fence: the drive writes and reports nothing more. */
	| { kind: "fenced" };

export type Thread = {
	readonly runId: string;
	/** The one StepContext of the thread. A test may swap a field of it. */
	readonly ctx: StepContext;
	readonly graph: RunGraph;
	/**
	 * Every write of the thread's drives goes through it. A stop closes it
	 * and drops the thread, so the next drive of the run opens a new
	 * thread with a new fence.
	 */
	readonly fence: Fence;
	readonly saver: FencedSaver;
	/**
	 * Streams one drive. `controller` is what `ctx.signal()` gives while it
	 * runs; it is set before the first await, so a stop that comes later
	 * aborts this drive. `onEvent` gets each custom chunk (`RunEvent`).
	 */
	drive(
		input: StreamInput,
		options: { controller: AbortController; onEvent?(event: RunEvent): void },
	): Promise<DriveOutcome>;
	/** Where the thread is, from its latest checkpoint. */
	state(): Promise<ThreadState>;
	/** The latest checkpoint: where the thread is, its values, and its tasks. */
	snapshot(): Promise<ThreadSnapshot>;
	/** Drops a task left at an interrupt or at a node cut short, so only a jump runs. */
	clearTasks(): Promise<void>;
	/**
	 * Keeps what a re-entry reads, and drops the rest of the thread
	 * (`LibsqlSaver.pruneThread`): the latest checkpoint of the root and of
	 * each namespace of a task that is not done (a body that parked, waits
	 * or was cut short inside a Call node goes on in its own namespace). A
	 * finished run has no task left: it keeps one checkpoint. Fenced.
	 */
	prune(): Promise<void>;
};

const configOf = (runId: string) => ({ configurable: { thread_id: runId } });

/** Opens the run's thread: compiles its flow snapshot over a fenced saver. */
export function openThread(row: RunRow, deps: ThreadDeps): Thread {
	const runId = row.id;
	const flow = deps.flowOf(row);
	const fence = createFence(runId);
	let controller = new AbortController();
	const ctx: StepContext = {
		db: deps.db,
		run: row,
		flow,
		flowName: row.flowName ?? row.title,
		flows: deps.calledFlowsOf(row),
		// Resolved at each use: the settings may change while the thread is open.
		policy: () => deps.policyFor(flow),
		log: fencedLog(deps.log, fence),
		bus: deps.bus,
		recorder: (stepId) => deps.recorders.open(runId, stepId),
		deviceFor: deps.deviceFor,
		deviceById: deps.deviceById,
		signal: () => controller.signal,
		now: deps.now,
		minuteMs: deps.minuteMs,
		dataDir: deps.dataDir,
		settings: deps.settings,
		kindOf,
	};
	const saver = new FencedSaver(deps.db, fence);
	const graph = compileFlow(flow, ctx).compile({ checkpointer: saver });

	async function snapshot(): Promise<ThreadSnapshot> {
		const latest = await graph.getState(configOf(runId));
		const values = latest.values as Partial<RunStateValues>;
		const hasCheckpoint =
			latest.config?.configurable?.checkpoint_id !== undefined;
		return {
			state: stateOf(latest, values, hasCheckpoint),
			values,
			hasCheckpoint,
			hasTasks: latest.tasks.length > 0,
		};
	}

	return {
		runId,
		ctx,
		graph,
		fence,
		saver,
		drive(input, options) {
			controller = options.controller;
			return driveGraph(graph, runId, input, {
				fence,
				...(options.onEvent ? { onEvent: options.onEvent } : {}),
			});
		},
		state: async () => (await snapshot()).state,
		snapshot,
		async clearTasks() {
			await graph.updateState(configOf(runId), null, END);
		},
		prune: () => saver.pruneThread(runId),
	};
}

type GraphSnapshot = Awaited<ReturnType<RunGraph["getState"]>>;

function stateOf(
	snapshot: GraphSnapshot,
	values: Partial<RunStateValues>,
	hasCheckpoint: boolean,
): ThreadState {
	const interrupt = snapshot.tasks
		.flatMap((task) => task.interrupts)
		.find((i) => i.value !== undefined);
	if (interrupt) {
		return { kind: "interrupted", value: interrupt.value as Parked };
	}
	// `next` leaves out a task whose writes are saved but whose super-step
	// has no checkpoint yet (the daemon died, or a stop came, in between).
	// The thread is still at that task: `invoke(null)` applies its writes
	// and goes on.
	const next =
		snapshot.next.length > 0
			? snapshot.next
			: snapshot.tasks.map((task) => task.name);
	if (next.length > 0) return { kind: "pending", next: [...next] };
	if (!hasCheckpoint) return { kind: "fresh" };
	return { kind: "ended", ended: values.ended ?? null };
}

/**
 * Streams one drive of `graph` (thread id `runId`) and says how it ended.
 * Throws for an engine failure, and for a graph that stops without an end
 * or an interrupt. A drive whose fence closed reports `fenced`, whatever
 * it threw: the stop took the run and wrote its end.
 */
export async function driveGraph(
	graph: RunGraph,
	runId: string,
	input: StreamInput,
	options: { fence: Fence; onEvent?(event: RunEvent): void },
): Promise<DriveOutcome> {
	const { fence, onEvent } = options;
	try {
		const stream = await graph.stream(input, {
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
		const interrupts: Parked[] = [];
		for await (const chunk of stream) {
			const [namespace, mode, data] = chunk as [string[], string, unknown];
			if (mode === "custom") {
				onEvent?.(data as RunEvent);
				continue;
			}
			if (namespace.length > 0) continue;
			const root = (data as Record<string, unknown>).__interrupt__ as
				| { value: Parked }[]
				| undefined;
			const first = root?.[0];
			if (first) interrupts.push(first.value);
		}
		if (fence.closed) return { kind: "fenced" };
		const parked = interrupts[interrupts.length - 1];
		if (parked) return { kind: "parked", parked, interrupts };
		const latest = await graph.getState(configOf(runId));
		const ended = (latest.values as Partial<RunStateValues>).ended;
		if (!ended) {
			throw new Error("The graph stopped without an end or an interrupt.");
		}
		if (fence.closed) return { kind: "fenced" };
		return { kind: "ended", ended };
	} catch (error) {
		if (fence.closed) return { kind: "fenced" };
		throw error;
	}
}

/**
 * What the runner appends for an outcome: the `RunEnded` status and
 * reason. Null when the run goes on: it waits, or a Gate is open, or a
 * stop took it.
 */
export function endingOf(
	outcome: DriveOutcome,
): { status: RunEnding; reason: string | null } | null {
	switch (outcome.kind) {
		case "ended":
			return { status: "finished", reason: outcome.ended.reason };
		case "parked":
			return outcome.parked.kind === "parked"
				? { status: outcome.parked.status, reason: outcome.parked.reason }
				: null;
		case "fenced":
			return null;
	}
}

/** One way into a thread. */
export type ThreadEntry =
	/** The flow's start node, with the run's inputs and stop time. */
	| { kind: "start"; inputs: Record<string, JsonValue>; stopAt: number | null }
	/** The node the thread is pending at runs again. `update` writes state first. */
	| { kind: "continue"; update?: RunStateUpdate }
	/** Answers the interrupt the thread sits at. `update` writes state before the node goes on. */
	| { kind: "resume"; value: ResumeValue; update?: RunStateUpdate }
	/** Jumps to a top-level node with `update` written first. */
	| { kind: "goto"; nodeId: string; update: RunStateUpdate };

/** The LangGraph input of an entry: the one place that builds a `Command`. */
export function inputOf(entry: ThreadEntry): StreamInput {
	switch (entry.kind) {
		case "start":
			return { inputs: entry.inputs, stopAt: entry.stopAt };
		case "continue":
			return entry.update ? new Command({ update: entry.update }) : null;
		case "resume":
			return new Command({
				resume: entry.value,
				...(entry.update ? { update: entry.update } : {}),
			});
		case "goto":
			// The node names are the flow's, which the graph's type cannot know.
			return new Command({
				goto: entry.nodeId,
				update: entry.update,
			}) as unknown as StreamInput;
	}
}
