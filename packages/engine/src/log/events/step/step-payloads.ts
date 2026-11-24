import type { CostSource } from "@nightshift/agents/pricing";
import type {
	AgentErrorKind,
	AgentHarnessName,
	AgentUsage,
} from "@nightshift/agents/types";
import type {
	AskForm,
	FlowNodeType,
	GateUrgency,
	ItemState,
	JsonValue,
	Outcome,
	OutcomeColor,
} from "@nightshift/flows";
import type { StepMemory } from "../../../memory";

/**
 * The events of a step, and the words their payloads use: its start and
 * end, its variables, its Gate, its sessions, the edge it takes, and the
 * flow and the items it calls.
 */

/** How a session ended. */
export type SessionOutcome = "finished" | "stopped" | "failed" | "interrupted";

/** A step's template outputs: JSON values, so `{{planner.data.tasks}}` can take a path. */
export type StepOutputs = Record<string, JsonValue>;

/** How a step stood in for its node in a test run: `StepStarted.test`. */
export type StandIn = "pinned" | "skipped";

/** Input values of a flow, by input name. */
export type InputValues = Record<string, JsonValue>;

/**
 * A Gate's deadline as the Gate opened with it: `at` (epoch ms) is when
 * the Gate takes the option `choose` if nobody answered.
 */
export type GateDeadline = { at: number; choose: string };

/**
 * One choice of a Gate: an option of its Decision node, with the colour the
 * node gives it, or a choice of an Agent that asks a person (`ask`).
 */
export type GateChoice = {
	name: string;
	description?: string;
	color?: OutcomeColor;
	/** The choice needs a note: the answer an Agent goes on with. */
	needsNote?: true;
	/**
	 * What happens when a person picks it (ADR 21): the option's `impact`
	 * rendered, or what a model wrote. Absent: nobody wrote one.
	 */
	impact?: string;
};

/** A part of a Gate's brief that a model can write (ADR 21). */
export type GateBriefPart =
	| "urgency"
	| "situation"
	| "background"
	| "recommendation"
	| "impacts";

/** One item of a Gate's background: what is done, and where the fact comes from. */
export type GateBackgroundItem = { text: string; source: string | null };

/**
 * The brief of a Gate (ADR 21): why a person must decide, what is already
 * done, which option the flow recommends, and who set the urgency. The
 * flow writes it, a model fills the parts the flow left empty, and
 * `byModel` names those parts. The impacts live on the choices.
 */
export type GateBrief = {
	urgencyBy: "flow" | "model" | "default";
	situation: string | null;
	background: GateBackgroundItem[];
	recommendation: { option: string | null; reason: string | null } | null;
	byModel: GateBriefPart[];
};

/**
 * Where a step runs: null at the top level of the run's flow, or inside a
 * flow that a Call step called. `parentStepId` is that step; `itemId` is
 * the element of a Call with `each` (null for a Call once). Step ids are
 * unique, so the innermost caller is enough: the caller has a scope of its
 * own, and the chain of scopes leads up to the top level.
 */
export type Scope = { parentStepId: string; itemId: string | null };

/** The key that separates node ids, visits, outputs and edge counts per scope. */
export function scopeKey(scope: Scope | null | undefined): string {
	return scope ? `${scope.parentStepId}/${scope.itemId ?? ""}` : "";
}

/** What the engine keeps of a list element when it starts or blocks it. */
export type ItemFacts = {
	id: string;
	title: string;
	url: string | null;
	/** The element as the source gave it. */
	value: JsonValue;
};

/** A guard that stopped a step. The idle guard's warning kind is `stalled`. */
export type StepGuard = "budget" | "turns" | "looping" | "idle" | "max_steps";

export type StepPayloads = {
	/** A new visit of a node. */
	StepStarted: {
		nodeId: string;
		nodeType: FlowNodeType;
		visit: number;
		transcriptPath: string;
		/** Command steps, and Call steps with a command source, only. */
		logPath: string | null;
		/** Null (or absent before Slice 4) at the top level. */
		scope?: Scope | null;
		/** The Device the step runs on. Absent before Devices: this computer. */
		deviceId?: string;
		/**
		 * Where the step stands on its node's ladder (Q31): who works or
		 * decides, and which tier of the cascade it tries. Absent for a step
		 * on no ladder, and in logs from older Walkers (`read/ladder.ts`
		 * reads those from the step's outputs).
		 */
		rung?: StepRung;
		/**
		 * The step stands in for its node in a test run (ADR 27): it gives
		 * the pinned output or the skipped outcome, on no Device and with no
		 * rung. Absent: the node ran.
		 */
		test?: StandIn;
	} & StepBudget;
	/**
	 * An ended step runs again: an Agent step in a new session of the same
	 * harness session, a Call step to continue its called flow.
	 */
	StepReopened: { prompt: string | null } & StepBudget;
	StepEnded: {
		outcome: StepOutcome;
		outputs: StepOutputs;
		error: string | null;
		/**
		 * What the step spent outside harness sessions, for example a
		 * Decision's decider. Harness sessions report their own cost in
		 * `SessionEnded`. Absent in logs written before Slice 3.
		 */
		costUsd?: number | null;
		/**
		 * Where `costUsd` came from. Null: the decider answered, but its cost
		 * is not known. Absent in older logs, and when nothing was asked.
		 */
		costSource?: CostSource | null;
		/**
		 * The guard that stopped the step, when one did. Absent when the
		 * step ended on its own.
		 */
		guard?: StepGuard;
		/**
		 * The variables the step's writes (`set`) changed, by name. Absent
		 * when it wrote none. In `StepEnded`, so a step never ends without
		 * its writes, or the reverse.
		 */
		variables?: Record<string, JsonValue>;
		/**
		 * The kept variables (`keep`) among `variables`, and the flow that
		 * keeps them: another Replica saves them from this event too
		 * (`ingestKeptValues`). Absent when the step wrote none, in a test
		 * run (ADR 27), and in older logs.
		 */
		kept?: { flowName: string; names: string[] };
		/**
		 * What a Since last run step saw new or changed (only the changes),
		 * and the node it is the memory of: another Replica saves it from
		 * this event too. Absent for every other step, when nothing was new
		 * or changed, in a run of a flow that is not saved, in a test run,
		 * and in older logs.
		 */
		memory?: StepMemory;
		/**
		 * The shapes of the step's data, by output field (`data`), when its
		 * node has no output schema yet: the Walker keeps them on the node,
		 * marked inferred (`ProjectFlows.keepShapes`). Absent when the node
		 * has a schema, the step gave no data, its flow keeps none (a kit, a
		 * quick run, a test run), and in older logs.
		 */
		shapes?: Record<string, Record<string, unknown>>;
	};
	/**
	 * The variables of a flow when it starts (each `initial`, or a kept
	 * value), in the scope the flow runs in: null at the top level of the
	 * run.
	 */
	VariablesSet: {
		values: Record<string, JsonValue>;
		scope: Scope | null;
		/**
		 * The kept variables (`keep`) that start from the value an earlier
		 * run left, not from `initial`. Absent when none does.
		 */
		kept?: string[];
	};
	/**
	 * A Gate step asks a person and waits. The step stays open until a person
	 * answers (`StepEnded` with the choice) or stops the run (`StepEnded` with
	 * `stopped`). An open Gate makes the run `waiting`, and it survives a
	 * daemon restart: it is a fact, not a timer.
	 */
	GateOpened: {
		/** The rendered question. */
		question: string;
		choices: GateChoice[];
		/**
		 * How soon it needs an answer, and its brief (ADR 21). Written only
		 * when the flow or a model set any of it, so absent in older logs and
		 * on a Gate with nothing to say: those read as `today`, set by
		 * default, with an empty brief.
		 */
		urgency?: GateUrgency;
		brief?: GateBrief;
		/**
		 * What the model that wrote the brief cost, as a decider's cost on
		 * `StepEnded`. Absent: no model was asked.
		 */
		briefCostUsd?: number | null;
		briefCostSource?: CostSource | null;
		/**
		 * The flow author marked this Gate to be answered from the lock
		 * screen (`lockScreen` on its Decision). Written only when true, so
		 * absent in older logs and on every other Gate. Kept with the Gate,
		 * not read from the flow file, so an edit of the flow after it opened
		 * does not change it.
		 */
		lockScreen?: true;
		/**
		 * When nobody answered by then, the Gate takes an option (`deadline`
		 * on its Decision). Written only when the Gate has one, with the time
		 * rendered when it opened, so a restart keeps the same deadline.
		 */
		deadline?: GateDeadline;
		/**
		 * An Ask (a Value made by a person, ADR 10): the form the answer
		 * fills in. Its one choice is `answer`, and the answer's data is the
		 * step's `data`. Absent on every other Gate.
		 */
		form?: AskForm;
	};
	SessionStarted: {
		prompt: string;
		/** The harness session this session continues, on a resume. */
		resumeSessionId: string | null;
		harness: AgentHarnessName;
	};
	HarnessSessionAssigned: { harnessSessionId: string; model: string | null };
	/**
	 * What a session has spent so far: a running total, logged while it
	 * runs, at most every few seconds. Only harnesses that report usage
	 * while they work have it. `SessionEnded` has the final cost; without
	 * one (the session failed, or Night Shift stopped), the last total counts.
	 */
	SessionUsage: {
		usage: AgentUsage;
		costUsd: number | null;
		costSource?: CostSource | null;
	};
	SessionEnded: {
		outcome: SessionOutcome;
		error: string | null;
		errorKind: AgentErrorKind | null;
		usage: AgentUsage | null;
		costUsd: number | null;
		/** Where `costUsd` came from. Absent in older logs: reported, when set. */
		costSource?: CostSource | null;
		/** Epoch ms when a usage limit resets, when the harness reports it. */
		resetAt: number | null;
	};
	EdgeTaken: {
		edgeId: string;
		from: string;
		to: string;
		outcome: Outcome;
		/** The scope the edge belongs to. Null (or absent) at the top level. */
		scope?: Scope | null;
	};
	/**
	 * A Call step (once) calls its flow with these input values (bindings
	 * rendered, defaults applied). The called flow runs in the step's scope.
	 */
	FlowCalled: { flow: string; inputs: InputValues };
	/** A Call step with `each` read its source. */
	ItemsRead: { count: number; open: number };
	/** A Call step with `each` starts an element: its flow runs in the scope of this element. */
	ItemStarted: {
		item: ItemFacts;
		/** 1 for the first item the visit started. */
		index: number;
		/** Null without a branch per item. */
		branch: string | null;
		baseBranch: string | null;
		/**
		 * The input values of the called flow for this element. Absent before
		 * flow format 2: the element was the only input, `item`.
		 */
		inputs?: InputValues;
	};
	/** An item that never starts: a blocker of it failed or is blocked. */
	ItemBlocked: { item: ItemFacts; blocker: string; reason: string };
	ItemEnded: {
		itemId: string;
		state: Exclude<ItemState, "running" | "blocked">;
		reason: string | null;
		/** The called flow's declared outputs for this element. Absent before flow format 2. */
		outputs?: StepOutputs;
	};
};

/**
 * A step's time budget, on `StepStarted` and `StepReopened`, so it outlives
 * the timers of the process that runs the step (`deriveStepClocks`). Each
 * field is set only when the step has that limit, and absent in logs from
 * before it: such a step has only its timers.
 */
export type StepBudget = {
	/** How long the step may run (its node's `timeoutMinutes`), in ms. */
	timeoutMs?: number;
	/** How long the step may go without activity (`idleMinutes`), in ms. */
	idleMs?: number;
};

/**
 * Who works or decides on a step of a ladder: a `rule`, a decider
 * (`model`), an `agent`, a called flow (`flow`) or a `person` (a Gate, an
 * Ask, a cascade's person tier).
 */
export type RungBy = "rule" | "model" | "agent" | "flow" | "person";

/**
 * Where a step stands on its node's ladder (`StepStarted.rung`). The work
 * ladder holds Agent, Subflow and Value steps, the choice ladder Decision
 * steps. A Value by rule is on no ladder.
 */
export type StepRung = {
	by: RungBy;
	/** The index of its tier in the node's cascade. Absent: the node has no cascade. */
	tier?: number;
	/** No try follows when this one does not hold: the climb ends here. */
	last?: true;
};

/**
 * How one visit of a node ended: one of the node's outcomes (`pass`, a
 * Decision label, a Gate choice, …) or one of the reserved values below.
 */
export type StepOutcome =
	| Outcome
	| "error" // the harness or the command could not run, or the step timed out
	| "stopped" // a person stopped the run
	| "interrupted"; // the daemon died while the step ran
