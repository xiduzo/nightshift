import type { Command } from "@langchain/langgraph";
import type { CostSource } from "@nightshift/agents/pricing";
import type { TemplateContext } from "@nightshift/flows";
import type { Device } from "../../device";
import type {
	DerivedStep,
	EnginePayloads,
	GateChoice,
	KnowledgeUseEvent,
	RunState,
	RunWarningKind,
	StandIn,
	StepEvent,
	StepGuard,
	StepOutcome,
	StepOutputs,
} from "../../log";
import type { StepMemory } from "../../memory";
import type { Climb } from "../cascade";
import type { ResumeRules } from "../context";
import type { StepEnd } from "../route";
import type { CascadeTry, RunStateUpdate } from "../state";
import type { WrittenBrief } from "./gate-brief";
import type { StepEntry } from "./resume-point";
import type { DeviceWait, OwnWait, WaitRequest } from "./sleep";

/**
 * The seam between the step runner and a node: how a step starts
 * (`StepStart`), what a body reads and records (`StepHandle`), how it ends
 * (`BodyResult`), what a node tells the runner (`StepSpec`), and the lower
 * seam of the loop-shaped nodes (`OpenStep`). `step-runner.ts` says how the
 * runner uses them.
 */

/**
 * Why a step's signal aborted. `outrun`: another branch reached a `first`
 * Join (`branches.ts`). `idle`: the Agent showed no activity for its idle
 * limit (the stall guard). The guards a body trips (`StepHandle.halt`):
 * `budget` (the run passed its budget), `turns` (a session passed its turn
 * limit), `looping` (the same tool call three times in a row).
 */
export type AbortReason =
	| "stopped"
	| "timeout"
	| "idle"
	| "outrun"
	| GuardReason;

/** A guard of the run policy that a body trips. */
export type GuardReason = "budget" | "turns" | "looping";

/**
 * How a node enters: a new visit (the default), or an existing step of the
 * node: `reopen` appends `StepReopened` (a person resumed a parked step, or
 * the daemon re-runs the node after a restart); `continue` appends nothing
 * (the step waited, and the wait ended). A `quiet` continue also tells the
 * bus and the custom stream nothing: the step did not start again (a Gate
 * that ends on its answer).
 */
export type StepStart =
	/**
	 * `untimed`: the step has no timers, whatever its kind says: the Gate of
	 * a cascade's person tier. `standIn`: the step stands in for its node in
	 * a test run (ADR 27): no timers, no Device, no rung.
	 */
	(
		| { kind: "new"; untimed?: true; standIn?: StandIn }
		| { kind: "reopen"; stepId: string; prompt: string | null }
		| { kind: "continue"; stepId: string; quiet?: boolean }
	) & {
		/**
		 * The step is a try of a cascade (ADR 6), or its person tier: its
		 * templates read `{{cascade.*}}`, and every end of the step adds the
		 * try's `tier` and `tries` to its outputs.
		 */
		climb?: Climb;
	};

/** One harness session of an Agent step, as the runner records it. */
export type SessionRecord = {
	id: string;
	/** The harness named its session: the row and `HarnessSessionAssigned`. */
	assigned(harnessSessionId: string, model: string | null): Promise<void>;
	/** `SessionUsage`: what the session has spent so far. */
	spent(payload: EnginePayloads["SessionUsage"]): Promise<void>;
	/** `SessionEnded` with how the session ended. */
	ended(payload: EnginePayloads["SessionEnded"]): Promise<void>;
};

/** A step in progress: what a node body reads and records. */
export type StepHandle = {
	stepId: string;
	visit: number;
	/** The Device the step runs on: the body's one way to touch a computer. */
	device: Device;
	/**
	 * The run's worktree on the step's Device, where a command or a session
	 * works. Another Device's path when the step runs there.
	 */
	worktree: string;
	/** The step as the log had it, for a reopened or continued step; null for a new visit. */
	existing: DerivedStep | null;
	/** The run state as read on entry, before this step's own events. */
	runState: RunState;
	tctx: TemplateContext;
	/** The step's own signal: a stop of the run, the node's time budget, or no activity for too long. */
	signal: AbortSignal;
	/** Writes one transcript entry (on disk, on the bus, on the custom stream). */
	record(sessionId: string | null, event: StepEvent): void;
	/** Resets the idle clock (Agent nodes with `idleMinutes`). */
	touch(): void;
	/**
	 * Starts a harness session of this step: the `agent_session` row and
	 * `SessionStarted` (one write of the drive), the bus. The body records
	 * the rest through the returned record, so no node touches the
	 * database.
	 */
	session(start: EnginePayloads["SessionStarted"]): Promise<SessionRecord>;
	/** Logs a warning about this step (`RunWarned`): it did not fail, but a person should know. */
	warn(kind: RunWarningKind, message: string): Promise<void>;
	/**
	 * Logs that an agent of the session searched or read the project's
	 * knowledge (`KnowledgeSearched`, `KnowledgeRead`). A failed write is
	 * left out: the step goes on.
	 */
	usedKnowledge(sessionId: string, used: KnowledgeUseEvent): Promise<void>;
	/**
	 * Trips a guard of the run policy: aborts the step's signal with the
	 * guard as its reason, so the session stops. The body then returns
	 * `aborted`; the runner ends the step `fail` with `message` and lands
	 * the guard's warning, or for `budget` stops the run `failed`. The
	 * first reason wins.
	 */
	halt(reason: GuardReason, message: string): void;
};

/**
 * The lower seam for the loop-shaped nodes: the body's handle plus how the
 * step opened and how it closes.
 */
export type OpenStep = StepHandle & {
	/** How the step was opened. */
	opened: StepStart["kind"];
	/**
	 * Closes the step: `StepEnded` in the log, the recorder and the timers
	 * closed, the bus and the custom stream told. The node then routes on
	 * the returned end (`route()`), or parks: `endAndGo` does the first.
	 */
	end(
		outcome: StepOutcome,
		outputs: StepOutputs,
		error: string | null,
		extra?: EndExtra & {
			/** The node's variable writes do not apply: a try of a cascade that climbs on. */
			skipWrites?: boolean;
		},
	): Promise<StepEnd>;
	/**
	 * Closes the step and goes on: a try of a cascade (`StepStart.climb`)
	 * that did not hold climbs to its next try while one is left, with none
	 * of the node's writes and no scores. Any other end scores what the
	 * step's data says (`dataScores`) and routes (`route()`), with `update`.
	 * `trail` is what the climb keeps of the try besides its outputs.
	 */
	endAndGo(
		outcome: StepOutcome,
		outputs: StepOutputs,
		error: string | null,
		extra?: EndExtra & {
			update?: RunStateUpdate;
			trail?: Partial<CascadeTry>;
		},
	): Promise<Command>;
	/** Closes the recorder and the timers but leaves the step open in the log (a wait). */
	leaveOpen(): void;
};

/** What a step's end records besides its outcome, outputs and error. */
export type EndExtra = {
	costUsd?: number | null;
	costSource?: CostSource | null;
	harnessSessionId?: string | null;
	/** The guard that stopped the step. */
	guard?: StepGuard;
	/** What a Since last run step saw new or changed: saved with `StepEnded`. */
	memory?: StepMemory;
};

/**
 * What `beginStep` gives: a step to run, or the `command` the node returns
 * instead: the run parked before the step, or the node is on a branch
 * another branch outran, and goes no further (a command with no goto).
 */
export type BeginStep =
	| { kind: "step"; step: OpenStep }
	| { kind: "parked"; command: Command };

/** How a body ended its step; the runner writes `StepEnded` from it. */
export type BodyEnd = {
	kind: "end";
	outcome: StepOutcome;
	/** The step's outputs; the runner stamps `outcome` on them. */
	outputs: StepOutputs;
	error: string | null;
	/** What a decider cost, when one was asked: on `StepEnded` as `costUsd`. */
	costUsd?: number | null;
	/** Where that cost came from. Null: the decider answered, its cost is not known. */
	costSource?: CostSource | null;
	/** Agent steps: the harness session the step has, for a reopen. */
	harnessSessionId?: string | null;
	/**
	 * What a Since last run step saw new or changed: `StepEnded.memory`,
	 * saved in its batch. Left out when the step ends `error` instead.
	 */
	memory?: StepMemory;
	/**
	 * A try of a cascade: what the climb keeps of it besides its outputs,
	 * for the next try and the person tier (a Value's answer).
	 */
	trail?: Partial<CascadeTry>;
};

/**
 * What a body returns:
 *
 * - `end`: the step ended with this outcome; the runner routes on it.
 * - `aborted`: the body saw its signal abort and stopped its work; the
 *   runner reads the signal's reason and ends the step `stopped` (a person
 *   stopped the run) or `error` (the time budget, or no activity), with the
 *   outputs the body had so far.
 * - `wait`: a usage limit or a network failure (`WaitRequest`); the sleep
 *   module plans the policy's wait and parks at the wait node, or the step
 *   ends when the wait would pass the stop time or the grace is spent
 *   (`StepSpec.givesUp`).
 * - `sleep`: a Wait node worked out its own wake time (`OwnWait`); the
 *   sleep module persists it and parks at the wait node, the step open.
 * - `ask`: the body asks a person (an Agent with `ask`): the runner opens a
 *   Gate on the step (`openGate`) and goes to the node's ask node, the
 *   step open. `outputs` are what a Stop ends the step with.
 */
export type BodyResult =
	| BodyEnd
	| {
			kind: "aborted";
			outputs: StepOutputs;
			costUsd?: number | null;
			costSource?: CostSource | null;
			harnessSessionId?: string | null;
	  }
	| ({
			kind: "wait";
			costUsd?: number | null;
			costSource?: CostSource | null;
	  } & WaitRequest)
	| ({ kind: "sleep" } & OwnWait)
	| ({ kind: "offline" } & DeviceWait)
	| {
			kind: "ask";
			question: string;
			choices: GateChoice[];
			outputs: StepOutputs;
			/** The brief the agent gave with its question (ADR 21). */
			brief?: Omit<WrittenBrief, "cost">;
	  };

/** What a node tells the runner: how it re-enters, what its body does, what an empty end looks like. */
export type StepSpec = {
	/** Which existing step the node takes up again (`RESUME_RULES`). */
	rules: ResumeRules;
	/**
	 * The body: the node's own work, from `StepStarted` to its end. `entry`
	 * says how the step was entered, with the prompt and the harness session
	 * a continued or reopened step carries.
	 */
	body(step: StepHandle, entry: StepEntry): Promise<BodyResult>;
	/**
	 * The outputs of a step that ends before its body spoke (the wait ended
	 * past the stop time, the body threw, a wait gave up): the visit and the
	 * kind's empty fields. Default `{ visit }`.
	 */
	outputs?(step: StepHandle): StepOutputs | Promise<StepOutputs>;
	/**
	 * How the step ends when its Device cannot serve it. `why` is null
	 * when the step would wait past the run policy's network grace: a
	 * network wait that gives up, or a Device that stays offline that long.
	 * `why` says what happened when the Device cannot be made ready
	 * (`readyDevice`): the run's copy or folder cannot be made, or the run's
	 * work cannot move to it. Without it, a wait that gives up and a Device
	 * that is not ready end the step `error`, and the step sleeps as long as
	 * its Device is offline. An End that reads its report from a file has
	 * it: a report never fails a run (ADR 26).
	 */
	givesUp?(step: StepHandle, why: string | null): Promise<BodyEnd>;
	/** What the step's route writes besides its end: a Join closes its round. */
	update?: RunStateUpdate;
	/**
	 * The step is a try of a cascade (ADR 6, `climb.ts`): its templates read
	 * `{{cascade.*}}`, its outputs add `tier` and `tries`, and an end that
	 * does not hold climbs to the next try while one is left, instead of
	 * routing. A climbing end writes none of the node's variables and scores
	 * nothing: only the try that routes does.
	 */
	climb?: Climb;
	/**
	 * The step stands in for its node in a test run (`stand-in.ts`, ADR 27):
	 * the body only gives the pinned output or the skipped outcome. The
	 * step asks no Device, records no changes, and scores nothing.
	 */
	standIn?: StandIn;
};
