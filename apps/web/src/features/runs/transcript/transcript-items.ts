/** The display items of a transcript, one type per kind. `transcript.ts` folds the entries of a run into them. */
import type { JsonValue, OutcomeColor } from "@nightshift/flows";
import type {
	AgentErrorKind,
	AgentUsage,
	GateChoice,
	ItemState,
	WaitEvent,
} from "@/shared/api";

type ItemBase = {
	key: string;
	/** The engine's agent session id. Null for command steps. */
	sessionId: string | null;
	at: number;
};

export type SessionItem = ItemBase & {
	kind: "session";
	sessionId: string;
	model?: string;
	harnessSessionId?: string;
};

export type MessageItem = ItemBase & { kind: "message"; text: string };

export type ToolItem = ItemBase & {
	kind: "tool";
	toolCallId: string;
	name: string;
	/** Set once the harness has the full input. */
	input?: unknown;
	hasInput: boolean;
	result?: string;
	/** A Tool node's call: the connection it called. Absent for an agent's tool call. */
	connection?: string;
	/**
	 * The call failed: an agent's tool call whose result the harness marked
	 * as an error, or a Tool node's call that the tool answered with an
	 * error or that could not be made.
	 */
	failed?: boolean;
};

export type ReportItem = ItemBase & {
	kind: "report";
	/** pass, fail, needs-input, or one of the node's own outcomes. */
	outcome: string;
	summary: string;
	/** The report's structured data, when the node has an output schema. */
	data?: unknown;
};

export type FinishedItem = ItemBase & { kind: "finished"; usage?: AgentUsage };

export type ErrorItem = ItemBase & {
	kind: "error";
	errorKind: AgentErrorKind;
	message: string;
	resetAt?: number;
};

export type CommandItem = ItemBase & { kind: "command"; command: string };

export type LogChunk = { stream: "stdout" | "stderr"; text: string };

/** All output of one command, in order. Neighbouring chunks of one stream are merged. */
export type LogItem = ItemBase & { kind: "log"; chunks: LogChunk[] };

export type ExitItem = ItemBase & { kind: "exit"; exitCode: number | null };

/** What the decider was asked. The prompt is rendered, templates filled in. */
export type DecisionAskItem = ItemBase & {
	kind: "decision-ask";
	prompt: string;
	labels: string[];
	model: string;
};

/** The label the decider picked, and why. */
export type DecisionItem = ItemBase & {
	kind: "decision";
	label: string;
	notes: string;
};

/** A rule decided: the option that matched (null when none did), and what each rule gave. */
export type RuleItem = ItemBase & {
	kind: "rule";
	matched: string | null;
	evaluated: { option: string; result: JsonValue | null }[];
};

/** A Gate opened: the rendered question and the choices. */
export type GateOpenItem = ItemBase & {
	kind: "gate-open";
	question: string;
	choices: GateChoice[];
};

/** A person answered the Gate. */
export type GateResolvedItem = ItemBase & {
	kind: "gate-resolved";
	choice: string;
	/** The colour the Gate gave this choice, if any. */
	color?: OutcomeColor;
	note: string;
};

/** A Call step with `each` read its source. */
export type ItemsReadItem = ItemBase & {
	kind: "items-read";
	count: number;
	open: number;
};

export type ItemStartItem = ItemBase & {
	kind: "item-start";
	itemId: string;
	title: string;
	branch: string | null;
	baseBranch: string | null;
};

export type ItemEndItem = ItemBase & {
	kind: "item-end";
	itemId: string;
	state: ItemState;
	reason: string | null;
};

export type WaitReason = Extract<WaitEvent, { type: "wait" }>["reason"];

/**
 * The run sleeps: a usage limit or a network failure, or a Wait node's own
 * wait, until a time (null for a signal with no timeout).
 */
export type WaitItem = ItemBase & {
	kind: "wait";
	reason: WaitReason;
	until: number | null;
	message: string;
	/** The signal a Wait node waits for. */
	signal?: string;
};

/** The sleep ended: a timer, a person, or (with `signal`) a signal. */
export type WakeItem = ItemBase & { kind: "wake"; signal?: string };

/** What a Value step was asked: a rule's expression, or the rendered prompt and the model. */
export type ValueAskItem = ItemBase & {
	kind: "value-ask";
	by: "rule" | "model";
	source: string;
	model: string | null;
};

/** The value made (`problem` null), or why there is none. */
export type ValueItem = ItemBase & {
	kind: "value";
	data: JsonValue | null;
	problem: string | null;
};

export type TranscriptItem =
	| SessionItem
	| ItemsReadItem
	| ItemStartItem
	| ItemEndItem
	| WaitItem
	| WakeItem
	| DecisionAskItem
	| DecisionItem
	| RuleItem
	| GateOpenItem
	| GateResolvedItem
	| MessageItem
	| ToolItem
	| ReportItem
	| FinishedItem
	| ErrorItem
	| CommandItem
	| ValueAskItem
	| ValueItem
	| LogItem
	| ExitItem;
