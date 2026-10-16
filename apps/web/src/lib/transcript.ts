import type {
	AgentErrorKind,
	AgentUsage,
	GateChoice,
	ItemState,
	TranscriptEntry,
	WaitEvent,
} from "@/lib/api-types";

/**
 * Folds the raw transcript entries of a run into display items, per step. An
 * agent step gets one block per assistant message, one row per tool call, a
 * boundary per session, its step report, and the events that end a session.
 * A command step gets its command line, one log, and its exit code. A
 * decision step gets what was asked and the label it picked; a gate step its
 * question and the answer. A For Each step gets the item lists it read and a
 * start and an end per item. A wait of the run policy shows where it happens,
 * with the wake that ends it. Folding is incremental so a long replay and a fast
 * live stream only touch the items that change.
 */

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
	note: string;
};

/** A For Each read its source. */
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

/** The run sleeps: a usage limit or a network failure, until a time. */
export type WaitItem = ItemBase & {
	kind: "wait";
	reason: WaitReason;
	until: number;
	message: string;
};

export type WakeItem = ItemBase & { kind: "wake" };

export type TranscriptItem =
	| SessionItem
	| ItemsReadItem
	| ItemStartItem
	| ItemEndItem
	| WaitItem
	| WakeItem
	| DecisionAskItem
	| DecisionItem
	| GateOpenItem
	| GateResolvedItem
	| MessageItem
	| ToolItem
	| ReportItem
	| FinishedItem
	| ErrorItem
	| CommandItem
	| LogItem
	| ExitItem;

/** The transcript of one step. */
export type TranscriptState = {
	items: TranscriptItem[];
	/** Item key to index in `items`. */
	index: Map<string, number>;
};

export const emptyTranscript: TranscriptState = {
	items: [],
	index: new Map(),
};

/** The wait the run is in, if the latest wait has no wake after it. */
export type CurrentWait = {
	stepId: string;
	reason: WaitReason;
	until: number;
	message: string;
	at: number;
};

/** The transcripts of a run, by step id. */
export type RunTranscript = {
	steps: ReadonlyMap<string, TranscriptState>;
	/** Highest seq folded so far; -1 when empty. */
	lastSeq: number;
	lastWait: CurrentWait | null;
};

export const emptyRunTranscript: RunTranscript = {
	steps: new Map(),
	lastSeq: -1,
	lastWait: null,
};

/** Applies entries in seq order. Entries at or below `lastSeq` are ignored. */
export function applyEntries(
	state: RunTranscript,
	entries: TranscriptEntry[],
): RunTranscript {
	const fresh = entries.filter((entry) => entry.seq > state.lastSeq);
	if (fresh.length === 0) return state;
	fresh.sort((a, b) => a.seq - b.seq);

	const byStep = new Map<string, TranscriptEntry[]>();
	for (const entry of fresh) {
		const list = byStep.get(entry.stepId);
		if (list) list.push(entry);
		else byStep.set(entry.stepId, [entry]);
	}

	let lastWait = state.lastWait;
	for (const entry of fresh) {
		const event = entry.event;
		if (event.type === "wait") {
			lastWait = {
				stepId: entry.stepId,
				reason: event.reason,
				until: event.until,
				message: event.message,
				at: entry.at,
			};
		} else if (event.type === "wake") {
			lastWait = null;
		}
	}

	const steps = new Map(state.steps);
	for (const [stepId, stepEntries] of byStep) {
		steps.set(
			stepId,
			applyStepEntries(steps.get(stepId) ?? emptyTranscript, stepEntries),
		);
	}

	return {
		steps,
		lastSeq: fresh[fresh.length - 1]?.seq ?? state.lastSeq,
		lastWait,
	};
}

function applyStepEntries(
	state: TranscriptState,
	entries: TranscriptEntry[],
): TranscriptState {
	const items = state.items.slice();
	const index = new Map(state.index);

	const push = (item: TranscriptItem) => {
		index.set(item.key, items.length);
		items.push(item);
	};
	const update = <T extends TranscriptItem>(
		key: string,
		change: (item: T) => T,
	): boolean => {
		const position = index.get(key);
		if (position === undefined) return false;
		items[position] = change(items[position] as T);
		return true;
	};
	const ensureSession = (entry: TranscriptEntry, sessionId: string) => {
		const key = `session:${sessionId}`;
		if (!index.has(key)) {
			push({ kind: "session", key, sessionId, at: entry.at });
		}
		return key;
	};
	const ensureTool = (
		entry: TranscriptEntry,
		toolCallId: string,
		name: string,
	) => {
		const key = `tool:${entry.sessionId}:${toolCallId}`;
		if (!index.has(key)) {
			push({
				kind: "tool",
				key,
				sessionId: entry.sessionId,
				at: entry.at,
				toolCallId,
				name,
				hasInput: false,
			});
		}
		return key;
	};

	for (const entry of entries) {
		const sessionKey =
			entry.sessionId === null ? null : ensureSession(entry, entry.sessionId);
		const event = entry.event;
		const base = { sessionId: entry.sessionId, at: entry.at };

		switch (event.type) {
			case "session":
				if (sessionKey) {
					update<SessionItem>(sessionKey, (item) => ({
						...item,
						model: event.model ?? item.model,
						harnessSessionId: event.sessionId,
					}));
				}
				break;
			case "text": {
				const key = `message:${entry.sessionId}:${event.messageId}`;
				const found = update<MessageItem>(key, (item) => ({
					...item,
					text: item.text + event.delta,
				}));
				if (!found) {
					push({ ...base, kind: "message", key, text: event.delta });
				}
				break;
			}
			case "tool-start":
				ensureTool(entry, event.toolCallId, event.name);
				break;
			case "tool-end": {
				const key = ensureTool(entry, event.toolCallId, event.name);
				update<ToolItem>(key, (item) => ({
					...item,
					name: event.name,
					input: event.input,
					hasInput: true,
				}));
				break;
			}
			case "tool-result": {
				const key = ensureTool(entry, event.toolCallId, "tool");
				update<ToolItem>(key, (item) => ({ ...item, result: event.content }));
				break;
			}
			case "report":
				push({
					...base,
					kind: "report",
					key: `report:${entry.seq}`,
					outcome: event.outcome,
					summary: event.summary,
					data: event.data,
				});
				break;
			case "finished":
				push({
					...base,
					kind: "finished",
					key: `finished:${entry.seq}`,
					usage: event.usage,
				});
				break;
			case "error":
				push({
					...base,
					kind: "error",
					key: `error:${entry.seq}`,
					errorKind: event.kind,
					message: event.message,
					resetAt: event.resetAt,
				});
				break;
			case "command-start":
				push({
					...base,
					kind: "command",
					key: `command:${entry.seq}`,
					command: event.command,
				});
				break;
			case "command-output": {
				const last = items[items.length - 1];
				if (last?.kind === "log") {
					const chunks = last.chunks.slice();
					const tail = chunks[chunks.length - 1];
					if (tail && tail.stream === event.stream) {
						chunks[chunks.length - 1] = {
							stream: tail.stream,
							text: tail.text + event.text,
						};
					} else {
						chunks.push({ stream: event.stream, text: event.text });
					}
					items[items.length - 1] = { ...last, chunks };
				} else {
					push({
						...base,
						kind: "log",
						key: `log:${entry.seq}`,
						chunks: [{ stream: event.stream, text: event.text }],
					});
				}
				break;
			}
			case "command-exit":
				push({
					...base,
					kind: "exit",
					key: `exit:${entry.seq}`,
					exitCode: event.exitCode,
				});
				break;
			case "decision-start":
				push({
					...base,
					kind: "decision-ask",
					key: `decision-ask:${entry.seq}`,
					prompt: event.prompt,
					labels: event.labels,
					model: event.model,
				});
				break;
			case "decision":
				push({
					...base,
					kind: "decision",
					key: `decision:${entry.seq}`,
					label: event.label,
					notes: event.notes,
				});
				break;
			case "gate-open":
				push({
					...base,
					kind: "gate-open",
					key: `gate-open:${entry.seq}`,
					question: event.question,
					choices: event.choices,
				});
				break;
			case "gate-resolved":
				push({
					...base,
					kind: "gate-resolved",
					key: `gate-resolved:${entry.seq}`,
					choice: event.choice,
					note: event.note,
				});
				break;
			case "items-read":
				push({
					...base,
					kind: "items-read",
					key: `items-read:${entry.seq}`,
					count: event.count,
					open: event.open,
				});
				break;
			case "item-start":
				push({
					...base,
					kind: "item-start",
					key: `item-start:${entry.seq}`,
					itemId: event.itemId,
					title: event.title,
					branch: event.branch,
					baseBranch: event.baseBranch,
				});
				break;
			case "item-end":
				push({
					...base,
					kind: "item-end",
					key: `item-end:${entry.seq}`,
					itemId: event.itemId,
					state: event.state,
					reason: event.reason,
				});
				break;
			case "wait":
				push({
					...base,
					kind: "wait",
					key: `wait:${entry.seq}`,
					reason: event.reason,
					until: event.until,
					message: event.message,
				});
				break;
			case "wake":
				push({ ...base, kind: "wake", key: `wake:${entry.seq}` });
				break;
		}
	}

	return { items, index };
}

/** A one-line summary of a tool's input: the command, path, or pattern it acts on. */
export function summarizeToolInput(input: unknown): string {
	if (input == null) return "";
	if (typeof input === "string") return input;
	if (typeof input !== "object") return String(input);
	const record = input as Record<string, unknown>;
	for (const field of [
		"command",
		"file_path",
		"path",
		"notebook_path",
		"pattern",
		"url",
		"query",
		"description",
		"prompt",
	]) {
		const value = record[field];
		if (typeof value === "string" && value.length > 0) return value;
	}
	try {
		return JSON.stringify(input);
	} catch {
		return "";
	}
}

export function formatToolInput(input: unknown): string {
	if (typeof input === "string") return input;
	try {
		return JSON.stringify(input, null, 2);
	} catch {
		return String(input);
	}
}
