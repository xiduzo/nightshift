import type { AgentEvent } from "@nightshift/agents/types";
import type { ItemState, JsonValue } from "@nightshift/flows";
import type { RunResult } from "../run-status";
import type { GateChoice, GateDeadline } from "./events";

/**
 * What a step writes to its transcript, one entry per line, by step type.
 * An Agent step writes the harness's own events (`AgentEvent`).
 */

/** What a Decision step decided by a model writes to its transcript. */
export type DecisionEvent =
	| { type: "decision-start"; prompt: string; labels: string[]; model: string }
	| { type: "decision"; label: string; notes: string };

/**
 * What a Decision step decided by a rule writes to its transcript: the
 * option that matched (null when none did) and what each rule gave, in
 * order, up to the match. A default option (no rule) gives null.
 */
export type RuleEvent = {
	type: "rule";
	matched: string | null;
	evaluated: { option: string; result: JsonValue | null }[];
};

/** What a Decision step decided by a person (a Gate) writes to its transcript. */
export type GateEvent =
	| {
			type: "gate-open";
			question: string;
			choices: GateChoice[];
			deadline?: GateDeadline;
	  }
	| {
			type: "gate-resolved";
			choice: string;
			note: string;
			/** Nobody answered: the deadline took the choice. */
			byDeadline?: true;
	  };

/** What an End step writes to its transcript: how it ends the run, and its message. */
export type EndEvent = {
	type: "end";
	status: RunResult;
	message: string | null;
};

/** What a Call step with `each` writes to its transcript. */
export type ForEachEvent =
	| { type: "items-read"; count: number; open: number }
	| {
			type: "item-start";
			itemId: string;
			title: string;
			branch: string | null;
			baseBranch: string | null;
	  }
	| {
			type: "item-end";
			itemId: string;
			state: ItemState;
			reason: string | null;
	  };

/**
 * A wait of the run policy, or of a Wait node, written to the transcript of
 * the step that waits. `until` is null for a signal with no timeout;
 * `signal` names the signal a Wait node waits for, or the one that woke it.
 */
export type WaitEvent =
	| {
			type: "wait";
			reason:
				| "usage-limit"
				| "network"
				| "duration"
				| "time"
				| "command"
				| "signal"
				| "device-offline";
			until: number | null;
			message: string;
			signal?: string;
	  }
	| { type: "wake"; signal?: string };

/** What a command step writes to its transcript. */
export type CommandEvent =
	| { type: "command-start"; command: string }
	| { type: "command-output"; stream: "stdout" | "stderr"; text: string }
	| { type: "command-exit"; exitCode: number | null };

/**
 * What a Value step writes to its transcript: what it was asked (the
 * expression of a rule, or the rendered prompt and the model), then the
 * value it made, or why it made none (`problem`: the expression failed,
 * the model failed, or the data does not match the output schema).
 */
export type ValueEvent =
	| {
			type: "value-start";
			by: "rule" | "model";
			source: string;
			model: string | null;
	  }
	| { type: "value"; data: JsonValue | null; problem: string | null };

/**
 * What a Tool step writes to its transcript: the call it makes (arguments
 * rendered, never the server's config) and what the tool answered. `data`
 * is the structured content, else the JSON the text holds, else null.
 */
export type ToolEvent =
	| {
			type: "tool-call";
			connection: string;
			tool: string;
			arguments: Record<string, JsonValue>;
	  }
	| {
			type: "tool-called";
			isError: boolean;
			text: string;
			data: JsonValue | null;
	  };

export type StepEvent =
	| AgentEvent
	| CommandEvent
	| DecisionEvent
	| RuleEvent
	| GateEvent
	| ForEachEvent
	| WaitEvent
	| ValueEvent
	| ToolEvent
	| EndEvent;

/**
 * One line of a step's transcript file. `seq` increases by one per run,
 * across steps and sessions.
 */
export type TranscriptEntry = {
	seq: number;
	stepId: string;
	/** The engine's agent session id. Null for other steps. */
	sessionId: string | null;
	at: number;
	event: StepEvent;
};
