import type {
	AgentErrorKind,
	AgentUsage,
	TranscriptEntry,
} from "@/lib/api-types";

/**
 * Folds the raw transcript entries of a run into display items: one block per
 * assistant message, one row per tool call, a boundary per session, and the
 * events that end a session. Folding is incremental so a long replay and a fast
 * live stream only touch the items that change.
 */

export type SessionItem = {
	kind: "session";
	key: string;
	sessionId: string;
	at: number;
	model?: string;
	harnessSessionId?: string;
};

export type MessageItem = {
	kind: "message";
	key: string;
	sessionId: string;
	at: number;
	text: string;
};

export type ToolItem = {
	kind: "tool";
	key: string;
	sessionId: string;
	at: number;
	toolCallId: string;
	name: string;
	/** Set once the harness has the full input. */
	input?: unknown;
	hasInput: boolean;
	result?: string;
};

export type FinishedItem = {
	kind: "finished";
	key: string;
	sessionId: string;
	at: number;
	usage?: AgentUsage;
};

export type ErrorItem = {
	kind: "error";
	key: string;
	sessionId: string;
	at: number;
	errorKind: AgentErrorKind;
	message: string;
	resetAt?: number;
};

export type TranscriptItem =
	| SessionItem
	| MessageItem
	| ToolItem
	| FinishedItem
	| ErrorItem;

export type TranscriptState = {
	items: TranscriptItem[];
	/** Item key to index in `items`. */
	index: Map<string, number>;
	/** Highest seq folded so far; -1 when empty. */
	lastSeq: number;
};

export const emptyTranscript: TranscriptState = {
	items: [],
	index: new Map(),
	lastSeq: -1,
};

/** Applies entries in seq order. Entries at or below `lastSeq` are ignored. */
export function applyEntries(
	state: TranscriptState,
	entries: TranscriptEntry[],
): TranscriptState {
	const fresh = entries.filter((entry) => entry.seq > state.lastSeq);
	if (fresh.length === 0) return state;
	fresh.sort((a, b) => a.seq - b.seq);

	const items = state.items.slice();
	const index = new Map(state.index);
	let lastSeq = state.lastSeq;

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
	const ensureSession = (entry: TranscriptEntry) => {
		const key = `session:${entry.sessionId}`;
		if (!index.has(key)) {
			push({
				kind: "session",
				key,
				sessionId: entry.sessionId,
				at: entry.at,
			});
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

	for (const entry of fresh) {
		lastSeq = entry.seq;
		const sessionKey = ensureSession(entry);
		const event = entry.event;

		switch (event.type) {
			case "session":
				update<SessionItem>(sessionKey, (item) => ({
					...item,
					model: event.model ?? item.model,
					harnessSessionId: event.sessionId,
				}));
				break;
			case "text": {
				const key = `message:${entry.sessionId}:${event.messageId}`;
				const found = update<MessageItem>(key, (item) => ({
					...item,
					text: item.text + event.delta,
				}));
				if (!found) {
					push({
						kind: "message",
						key,
						sessionId: entry.sessionId,
						at: entry.at,
						text: event.delta,
					});
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
				update<ToolItem>(key, (item) => ({
					...item,
					result: event.content,
				}));
				break;
			}
			case "finished":
				push({
					kind: "finished",
					key: `finished:${entry.seq}`,
					sessionId: entry.sessionId,
					at: entry.at,
					usage: event.usage,
				});
				break;
			case "error":
				push({
					kind: "error",
					key: `error:${entry.seq}`,
					sessionId: entry.sessionId,
					at: entry.at,
					errorKind: event.kind,
					message: event.message,
					resetAt: event.resetAt,
				});
				break;
		}
	}

	return { items, index, lastSeq };
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
