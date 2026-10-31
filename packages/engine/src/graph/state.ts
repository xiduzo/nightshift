import { withLangGraph } from "@langchain/langgraph/zod";
import { type JsonValue, outcomeColorSchema } from "@nightshift/flows";
import { z } from "zod";
import type {
	GateChoice,
	GateDeadline,
	StepOutcome,
	StepOutputs,
	TranscriptEntry,
	WaitReason,
} from "../log";

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
	"any",
	"device-offline",
	"lease",
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
	/** What came with that signal: the webhook event (`{ body, headers }`) that sent it. */
	signalData: z.json().optional(),
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
			needsNote: z.literal(true).optional(),
		}),
	),
	/**
	 * An Agent that asks a person (`ask`): the step's outputs so far, which
	 * a Stop ends the step with.
	 */
	outputs: z.record(z.string(), z.any()).optional(),
	/**
	 * An Agent's Gate a person answered: the note its session goes on with.
	 * Set by the ask node, read by the resume point, which reopens the step.
	 */
	answer: z.string().optional(),
	/** When nobody answered by `at` (epoch ms), the Gate takes `choose`. */
	deadline: z.object({ at: z.number(), choose: z.string() }).optional(),
	/**
	 * The person tier of a cascade (ADR 6): its answer ends the step on an
	 * option (a Decision), or tries once more or stops (an Agent, a Call).
	 */
	climb: z.literal(true).optional(),
	/** An Ask (ADR 10): the form its answer fills in (an `AskForm`). */
	form: z.record(z.string(), z.any()).optional(),
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
	/**
	 * The result an End node gave (`NodeKind.endResult`): `failed` ends the
	 * run `failed`, the others `finished`. Absent for every other end.
	 */
	result: z.enum(["done", "nothing-to-do", "failed"]).optional(),
});
export type Ended = z.infer<typeof endedSchema>;

/**
 * The cursor of a Call node with `each`: the `index` of the last element that ended. It
 * marks the loop as mid-way (the node then continues its open step); the
 * list and the elements' states and results come from the log
 * (`ItemsRead`, `ItemStarted`, `ItemEnded`), not from the state.
 */
export type Loop = { index: number };

/** One try of a cascade, as the next try reads it (`{{cascade.previous}}`). */
export type CascadeTry = {
	/** The tier's name (`tierLabel`). */
	tier: string;
	/** The try's number within its tier, from 1. */
	try: number;
	outcome: string;
	/** What the try said: the agent's summary, the model's note, the flow's end message, or the error. */
	summary: string;
	/** A Decision's pick that did not hold, and its probability. */
	pick?: string;
	confidence?: number;
	/** The end of the log of an Agent's check, or of a called flow's last command. */
	log_tail?: string;
	/** An Agent's harness session: the next try of the tier resumes it with `session: "resume"`. */
	session_id?: string;
	/**
	 * A Value's answer of the model, when it is small: the person tier (an
	 * Ask, ADR 10) starts its form with the best one.
	 */
	data?: JsonValue;
};

/**
 * Where a node is on its cascade: the tier (an index into `cascade`), the
 * try within it (from 1), and the tries before, in order. `note` is a
 * person's, from the person tier's "try-again".
 */
export type CascadePosition = {
	tier: number;
	try: number;
	trail: CascadeTry[];
	note?: string;
};

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
	 * step is still open. The run position (`run-position.ts`) owns the
	 * rule: `commitVisit` is the one writer of this channel.
	 */
	visits: mergedRecord<number>(),
	/** How often each edge was taken. */
	traversals: mergedRecord<number>(),
	/** The cursors of Call nodes with `each`, by node id; null once the loop ended. */
	loops: mergedRecord<Loop | null>(),
	/**
	 * Where each node climbs its cascade (ADR 6), by node id: the tier and
	 * the try it runs, and the tries before. Written when a try does not
	 * hold and the node goes back to itself, so it commits with the
	 * checkpoint before the next try: a resume continues there. Null once
	 * the node routed on (`route()`); a park keeps it.
	 */
	cascades: mergedRecord<CascadePosition | null>(),
	/**
	 * The steps a wait, a park or a Gate holds, by node id: one per branch
	 * that holds one, so parallel branches each keep their own (`holds`).
	 * Read it through `heldOf`: a checkpoint from before parallel branches
	 * holds one `Pending` or null here.
	 */
	pending: withLangGraph(z.record(z.string(), pendingSchema), {
		reducer: { schema: z.any(), fn: holds },
		default: () => ({}) as Held,
	}),
	ended: withLangGraph(endedSchema.nullable(), {
		default: () => null as Ended | null,
	}),
	/** The round of each Join whose branches run or ran (`JoinRound`), by Join id. */
	joins: withLangGraph(z.record(z.string(), z.any()), {
		reducer: { schema: z.any(), fn: joinRounds },
		default: () => ({}) as Record<string, JoinRound>,
	}),
});
export type RunStateValues = Omit<
	z.infer<typeof RunState>,
	"pending" | "joins" | "cascades"
> & {
	pending: PendingValue;
	joins: Record<string, JoinRound>;
	/** Optional: a state a test or an older checkpoint writes may have none. */
	cascades?: Record<string, CascadePosition | null>;
};
/** A node's state update: the channels it writes. */
export type RunStateUpdate = Partial<
	Omit<RunStateValues, "pending" | "joins">
> & {
	pending?: PendingWrite;
	joins?: Record<string, JoinRound>;
};

/** The steps the checkpoint holds, by node id. */
export type Held = Record<string, Pending>;

/** `pending` as a checkpoint may hold it: by node id, or one hold or none from before parallel branches. */
export type PendingValue = Held | Pending | null;

/** The part of the state that says where the run is: what the run position reads (`positionOf`). */
export type PositionState = {
	pending?: PendingValue;
	loops?: RunStateValues["loops"];
	visits?: RunStateValues["visits"];
};

/**
 * A write to `pending`: a node's own hold (a `Pending`, kept under its
 * node), the release of one or more nodes (`{ [nodeId]: null }`), or
 * null: every hold goes (a re-entry starts clean).
 */
export type PendingWrite = Pending | Record<string, Pending | null> | null;

/** Whether a stored or written value is one `Pending`, not a record of them. */
function isPending(value: unknown): value is Pending {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { kind?: unknown }).kind === "string"
	);
}

/** The holds of a `pending` value, by node id. A checkpoint from before parallel branches holds one or none. */
export function heldOf(value: unknown): Held {
	if (value === null || value === undefined) return {};
	if (isPending(value)) return { [value.nodeId]: value };
	return value as Held;
}

/** The reducer of `pending`: a write sets or releases holds by node, null releases all. */
function holds(current: unknown, write: PendingWrite): Held {
	if (write === null) return {};
	const next = { ...heldOf(current) };
	if (isPending(write)) {
		next[write.nodeId] = write;
		return next;
	}
	for (const [nodeId, pending] of Object.entries(write)) {
		if (pending === null) delete next[nodeId];
		else next[nodeId] = pending;
	}
	return next;
}

/**
 * One round of a Join: a fan-out opened it, its branches arrive in it, and
 * the Join closes it when it goes on. A later fan-out of the same Join
 * opens the next round.
 */
export type JoinRound = {
	/** Counts the fan-outs into this Join. */
	round: number;
	/** The branches that arrived, by the node each entered the Join from, in order. */
	arrived: { from: string; at: number }[];
	/** The Join went on: a step of this round's branches that still runs goes no further. */
	closed: boolean;
};

/**
 * The reducer of `joins`, per Join: a later round replaces an earlier one,
 * an earlier round's write is late and goes, and writes to the same round
 * merge (branches that arrive in one super-step all count, and a close
 * stays closed).
 */
function joinRounds(
	current: Record<string, JoinRound>,
	write: Record<string, JoinRound>,
): Record<string, JoinRound> {
	const next = { ...current };
	for (const [joinId, round] of Object.entries(write)) {
		const now = next[joinId];
		if (!now || round.round > now.round) {
			next[joinId] = round;
			continue;
		}
		if (round.round < now.round) continue;
		const known = new Set(now.arrived.map((a) => a.from));
		next[joinId] = {
			round: now.round,
			arrived: [
				...now.arrived,
				...round.arrived.filter((a) => !known.has(a.from)),
			],
			closed: now.closed || round.closed,
		};
	}
	return next;
}

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
			/** The runner answers the Gate at the deadline (`GateDeadline`). */
			deadline?: GateDeadline;
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
 * - `gate`: the answer to a Gate. `byDeadline`: nobody answered, and the
 *   deadline took its option. `data`: the answer to an Ask (ADR 10), the
 *   data of its form.
 * - `signal`: someone sent the run a signal; a Wait node on it ends `done`.
 */
export type ResumeValue =
	| { kind: "wake"; early: boolean; prompt?: string }
	| { kind: "resume"; prompt?: string }
	| { kind: "reopen" }
	| {
			kind: "gate";
			choice: string;
			note?: string;
			byDeadline?: true;
			data?: JsonValue;
	  }
	/** A signal ended the wait. `data`: the webhook event that sent it, if one did. */
	| { kind: "signal"; name: string; data?: JsonValue };

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
