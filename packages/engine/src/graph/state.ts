import { withLangGraph } from "@langchain/langgraph/zod";
import { type JsonValue, outcomeColorSchema } from "@nightshift/flows";
import { z } from "zod";

import type { GateChoice, StepOutputs, WaitReason } from "../events";
import type { StepOutcome, TranscriptEntry } from "../types";

/**
 * The run state LangGraph checkpoints after every node, and the typed
 * payloads that cross the graph's boundary: what an interrupt carries
 * (`Parked`), what a resume carries (`ResumeValue`), and what a node streams
 * while it runs (`RunEvent`, the `custom` stream mode).
 *
 * The event log stays the read model (design rule 3). The state here is the
 * walk's own bookkeeping: node outputs and variables for templates, visit and edge counts,
 * Call cursors (`each`), and the step a park or a wait left pending, so that the
 * node the run re-enters continues the same step and harness session.
 * The log keeps the facts a person reads and the ones crash recovery
 * needs; the state keeps what the next node reads. A finished run keeps
 * its latest checkpoint only (`runner.ts`), and a thread from before this
 * engine, with no checkpoint, is re-entered with these channels seeded from
 * the log (`reentryUpdate`).
 */

/** A record channel whose updates merge in, key by key. */
function mergedRecord<V>() {
	const schema = z.record(z.string(), z.any());
	return withLangGraph(schema, {
		reducer: {
			schema,
			fn: (a: Record<string, V>, b: Record<string, V>) => ({ ...a, ...b }),
		},
		default: () => ({}) as Record<string, V>,
	});
}

const waitReasonSchema = z.enum([
	"usage-limit",
	"network",
	"duration",
	"time",
	"command",
	"signal",
	"device-offline",
]);

/**
 * The step a wait or a park left behind, for the node that re-enters.
 *
 * - `wait`: the step sleeps (a usage limit or the network, or a Wait node's
 *   own wait) and is still open in the log. Written by the sleep module
 *   only (`graph/sleep.ts`), read through its `pendingWaitOf`. The node
 *   continues the same step: same id, same visit, and for a policy wait
 *   the `session` it continues with its follow-up `prompt`. A Wait node
 *   reads `until`, the streak (when its wait began, how often it slept) and
 *   `signal`.
 * - `parked`: the step ended (`stopped` or `failed`) and the run parked at
 *   the node's park node. A resume sets `prompt` and jumps back to the node,
 *   which reopens the step (`StepReopened`, a new session of the same
 *   harness session) when it has one, else starts a new visit. `stepId` is
 *   null when the run parked before the node's step started (stop after
 *   step, stop time, step cap): the node then starts a new visit.
 * - `gate`: a Gate is open (below).
 *
 * Every node clears `pending` when it routes on (`route()` sets it null).
 */
const pendingWaitSchema = z.object({
	kind: z.literal("wait"),
	stepId: z.string(),
	nodeId: z.string(),
	visit: z.number(),
	reason: waitReasonSchema,
	/** Epoch ms when the step continues (`WaitStarted.until`); null for a signal with no timeout. */
	until: z.number().nullable(),
	message: z.string(),
	/**
	 * The step's waits for this reason, this one included: how many, and
	 * when the first began (epoch ms). `planWait` grows the next policy wait
	 * from it; a Wait node counts its deadline and `waited_minutes` from
	 * `since`. A new or reopened step, or a wait for another reason, starts
	 * a new streak.
	 */
	streak: z.object({ count: z.number(), since: z.number() }),
	/**
	 * What a policy wait continues after the wake: the harness session the
	 * log assigned (null while the harness named none, or for a decider) and
	 * the follow-up prompt (a person's on an early wake, else the default).
	 * Null for a Wait node: its step continues nothing.
	 */
	session: z
		.object({ harnessSessionId: z.string().nullable(), prompt: z.string() })
		.nullable(),
	/** A Wait node on a signal: the signal that ended the wait, set by the wait node on a signal resume. */
	signal: z.string().optional(),
});
const pendingParkedSchema = z.object({
	kind: z.literal("parked"),
	stepId: z.string().nullable(),
	nodeId: z.string(),
	visit: z.number(),
	harnessSessionId: z.string().nullable(),
	/** The resume prompt. Null until a person resumed. */
	prompt: z.string().nullable(),
	status: z.enum(["failed", "stopped"]),
	/** The run's end reason, as `RunEnded` records it. */
	reason: z.string().nullable(),
	/** True when the stop time stopped the run, not a person: a Call node's `stopped` edge may then go on. */
	atStopTime: z.boolean().optional(),
});
/**
 * A Gate the node opened (`GateOpened` is in the log) for its ask node to
 * interrupt with. Committed by the open node before the interrupt, so the
 * checkpoint, not only the log, knows the Gate is open.
 */
const pendingGateSchema = z.object({
	kind: z.literal("gate"),
	stepId: z.string(),
	nodeId: z.string(),
	visit: z.number(),
	question: z.string(),
	choices: z.array(
		z.object({
			name: z.string(),
			description: z.string().optional(),
			color: outcomeColorSchema.optional(),
		}),
	),
});
const pendingSchema = z.discriminatedUnion("kind", [
	pendingWaitSchema,
	pendingParkedSchema,
	pendingGateSchema,
]);
export type PendingWait = z.infer<typeof pendingWaitSchema>;
export type PendingParked = z.infer<typeof pendingParkedSchema>;
export type PendingGate = z.infer<typeof pendingGateSchema>;
export type Pending = z.infer<typeof pendingSchema>;

/**
 * Set by the node that ended the flow on a chosen end (design rule 2: only a
 * finished run reaches END). `reason` is what `RunEnded` records: null for
 * `pass` (`done` for a Call with `each`), else `Ended at node "x" with "y".`.
 */
const endedSchema = z.object({
	status: z.literal("finished"),
	nodeId: z.string(),
	outcome: z.string(),
	reason: z.string().nullable(),
});
export type Ended = z.infer<typeof endedSchema>;

/**
 * The cursor of a Call node with `each`: the `index` of the last element that ended. It
 * marks the loop as mid-way (the node then continues its open step); the
 * list and the elements' states and results come from the log
 * (`ItemsRead`, `ItemStarted`, `ItemEnded`), not from the state.
 */
export type Loop = { index: number };

export const RunState = z.object({
	/** The flow's input values, defaults applied. */
	inputs: withLangGraph(z.record(z.string(), z.any()), {
		default: () => ({}) as Record<string, JsonValue>,
	}),
	/**
	 * The run's stop time (epoch ms, `RunStarted.stopAt`): no step starts
	 * after it. Null without one, and once a person resumed the run past it
	 * (the resume's `Command` writes it null). Only the root's is read:
	 * a body gets its caller's through `configurable.stopAt` on every
	 * invoke (`runBody`), so a cleared stop time reaches every depth.
	 */
	stopAt: withLangGraph(z.number().nullable(), {
		default: () => null as number | null,
	}),
	/**
	 * True once a Call node followed its `stopped` edge: the stop time came,
	 * and the nodes after the edge wrap the run up. From then on steps start
	 * past the stop time, in this graph and in the flows it calls
	 * (`stopAtOf` reads no stop time).
	 */
	wrappingUp: withLangGraph(z.boolean(), {
		default: () => false,
	}),
	/** `StepEnded.outputs` of each node's latest ended visit, for templates. */
	nodes: mergedRecord<StepOutputs>(),
	/**
	 * The flow's variables, by name: the values it started with
	 * (`VariablesSet`), then each step's writes (`StepEnded.variables`). A
	 * body has its own: each invocation of a flow starts from its own
	 * declaration.
	 */
	vars: mergedRecord<JsonValue>(),
	/**
	 * Visits of each node this graph committed. The log counts one more for
	 * a step the node started and did not commit yet (a step that runs, a
	 * Gate that is open, or the step of a daemon that died, design rule 5);
	 * a node that waits or loops over elements commits its visit while its
	 * step is still open.
	 */
	visits: mergedRecord<number>(),
	/** How often each edge was taken. */
	traversals: mergedRecord<number>(),
	/** The cursors of Call nodes with `each`, by node id; null once the loop ended. */
	loops: mergedRecord<Loop | null>(),
	pending: withLangGraph(pendingSchema.nullable(), {
		default: () => null as Pending | null,
	}),
	ended: withLangGraph(endedSchema.nullable(), {
		default: () => null as Ended | null,
	}),
});
export type RunStateValues = z.infer<typeof RunState>;
/** A node's state update: the channels it writes. */
export type RunStateUpdate = Partial<RunStateValues>;

/**
 * What an interrupt carries. The runner reads it from the stream's
 * `__interrupt__` chunk (or `getState().tasks[].interrupts`) and reacts:
 * a `wait` schedules the wake timer; a `gate` is in the inbox; `parked`
 * appends `RunEnded` with its status and reason.
 */
export type Parked =
	| {
			kind: "wait";
			stepId: string;
			nodeId: string;
			reason: WaitReason;
			/** Null for a wait with no time (a signal with no timeout): no timer. */
			until: number | null;
			message: string;
	  }
	| {
			kind: "gate";
			stepId: string;
			nodeId: string;
			question: string;
			choices: GateChoice[];
	  }
	| {
			kind: "parked";
			/** Null when the run parked before the node's step started. */
			stepId: string | null;
			nodeId: string;
			status: "failed" | "stopped";
			reason: string | null;
			atStopTime?: boolean;
	  };

/**
 * What `Command({ resume })` carries, by the way the run resumes.
 *
 * - `wake`: a wait ended (the timer, or a person early). The runner appends
 *   `WaitEnded` and the transcript `wake` entry first. The Agent node
 *   continues the session with `prompt`, else "Continue where you left off."
 * - `resume`: a person continued a stopped or failed run (also one stopped
 *   while it slept). The engine appends `RunResumed` first.
 * - `reopen`: a person resumed a run that was stopped at a Gate: the gate
 *   node asks again.
 * - `gate`: the answer to a Gate.
 * - `signal`: someone sent the run a signal; a Wait node on it ends `done`.
 */
export type ResumeValue =
	| { kind: "wake"; early: boolean; prompt?: string }
	| { kind: "resume"; prompt?: string }
	| { kind: "reopen" }
	| { kind: "gate"; choice: string; note?: string }
	| { kind: "signal"; name: string };

/** What a step streams while it runs (LangGraph's `custom` stream mode). */
export type RunEvent =
	| {
			type: "step-started";
			stepId: string;
			nodeId: string;
			visit: number;
			/** A reopened or continued step, not a new visit. */
			reopened: boolean;
	  }
	| {
			type: "step-ended";
			stepId: string;
			nodeId: string;
			visit: number;
			outcome: StepOutcome;
	  }
	/** A transcript entry, after it is on disk and on the bus. */
	| { type: "transcript"; entry: TranscriptEntry };
