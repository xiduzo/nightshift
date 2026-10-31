import { lastWorktreeChanges, projectPath } from "@nightshift/client";

import type { TranscriptEntry, WorktreeChangesEvent } from "@/shared/api";
import { formatDuration } from "@/shared/format";
import type {
	GateOpenItem,
	MessageItem,
	SessionItem,
	ThinkingItem,
	ToolItem,
	TranscriptItem,
	WaitReason,
} from "./transcript-items";

/**
 * Folds the raw transcript entries of a run into display items, per step. An
 * agent step gets one block per assistant message, one item per thought, one
 * row per tool call (a subagent's work inside the call that started it), a
 * boundary per session, its step report, and the events that end a session.
 * A command step gets its command line, one log, and its exit code. A
 * decision step gets what was asked and the label it picked; a gate step its
 * question and the answer. A Call step with `each` gets the item lists it read and a
 * start and an end per item. A wait of the run policy shows where it happens,
 * with the wake that ends it. What a step changed in the run's copy of the
 * project is no item: the step keeps the last list (`changes`). Folding is
 * incremental so a long replay and a fast live stream only touch the items
 * that change.
 */

/** The transcript of one step. */
export type TranscriptState = {
	items: TranscriptItem[];
	/** Item key to index in `items`. */
	index: Map<string, number>;
	/** When the last entry came: where the next thought begins. */
	lastAt?: number;
	/** The key of the thought still streaming, if the last entry was one. */
	openThought?: string;
	/**
	 * Every file the step changed in the run's copy of the project, also by
	 * commands: its last `worktree-changes`. Absent when Night Shift could
	 * not tell.
	 */
	changes?: WorktreeChangesEvent;
};

export const emptyTranscript: TranscriptState = {
	items: [],
	index: new Map(),
};

/** The wait the run is in, if the latest wait has no wake after it. */
export type CurrentWait = {
	stepId: string;
	reason: WaitReason;
	until: number | null;
	message: string;
	/** The signal a Wait node waits for. */
	signal?: string;
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
				...(event.signal !== undefined ? { signal: event.signal } : {}),
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

/** The Gate that opened last: the one a gate-resolved entry answers. */
function lastGateOpen(items: TranscriptItem[]): GateOpenItem | undefined {
	for (let at = items.length - 1; at >= 0; at--) {
		const item = items[at];
		if (item?.kind === "gate-open") return item;
	}
	return undefined;
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

	let lastAt = state.lastAt;
	let openThought = state.openThought;
	const changes = lastWorktreeChanges(entries) ?? state.changes;
	for (const entry of entries) {
		const event = entry.event;
		// Not part of what the step said or ran: it changes no item.
		if (
			event.type === "worktree-snapshot" ||
			event.type === "worktree-changes"
		) {
			continue;
		}
		const sessionKey =
			entry.sessionId === null ? null : ensureSession(entry, entry.sessionId);
		const base = { sessionId: entry.sessionId, at: entry.at };
		const startedAt = lastAt ?? entry.at;
		lastAt = entry.at;

		// Anything after a thought ends it.
		const thoughtKey =
			event.type === "thinking"
				? `thinking:${entry.sessionId}:${event.messageId}`
				: undefined;
		if (openThought && openThought !== thoughtKey) {
			update<ThinkingItem>(openThought, (item) => ({ ...item, done: true }));
		}
		openThought = thoughtKey;

		// A subagent's work goes inside the call that started it.
		if (
			"parentToolCallId" in event &&
			event.parentToolCallId &&
			update<ToolItem>(
				`tool:${entry.sessionId}:${event.parentToolCallId}`,
				(item) => withSubagentStep(item, entry),
			)
		) {
			continue;
		}

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
			case "thinking": {
				const key = `thinking:${entry.sessionId}:${event.messageId}`;
				const found = update<ThinkingItem>(key, (item) => ({
					...item,
					text: item.text + event.delta,
					endedAt: entry.at,
				}));
				if (!found) {
					push({
						...base,
						kind: "thinking",
						key,
						text: event.delta,
						startedAt,
						endedAt: entry.at,
						done: false,
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
					endedAt: entry.at,
					// Older transcripts have no flag: their calls show as done.
					...(event.isError ? { failed: true } : {}),
				}));
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
					...(event.learnings?.length ? { learnings: event.learnings } : {}),
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
			case "rule":
				push({
					...base,
					kind: "rule",
					key: `rule:${entry.seq}`,
					matched: event.matched,
					evaluated: event.evaluated,
				});
				break;
			case "value-start":
				push({
					...base,
					kind: "value-ask",
					key: `value-ask:${entry.seq}`,
					by: event.by,
					source: event.source,
					model: event.model,
				});
				break;
			case "value":
				push({
					...base,
					kind: "value",
					key: `value:${entry.seq}`,
					data: event.data,
					problem: event.problem,
				});
				break;
			case "gate-open":
				push({
					...base,
					kind: "gate-open",
					key: `gate-open:${entry.seq}`,
					question: event.question,
					choices: event.choices,
					...(event.deadline ? { deadline: event.deadline } : {}),
				});
				break;
			case "gate-resolved": {
				const opened = lastGateOpen(items);
				const color = opened?.choices.find(
					(choice) => choice.name === event.choice,
				)?.color;
				push({
					...base,
					kind: "gate-resolved",
					key: `gate-resolved:${entry.seq}`,
					choice: event.choice,
					...(color === undefined ? {} : { color }),
					note: event.note,
					...(event.byDeadline ? { byDeadline: true as const } : {}),
				});
				break;
			}
			case "end":
				push({
					...base,
					kind: "end",
					key: `end:${entry.seq}`,
					status: event.status,
					message: event.message,
				});
				break;
			case "lease":
				push({
					...base,
					kind: "lease",
					key: `lease:${entry.seq}`,
					name: event.name,
					held: event.held,
					holderTitle: event.holderTitle ?? null,
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
					...(event.signal !== undefined ? { signal: event.signal } : {}),
				});
				break;
			case "wake":
				push({
					...base,
					kind: "wake",
					key: `wake:${entry.seq}`,
					...(event.signal !== undefined ? { signal: event.signal } : {}),
				});
				break;
			case "tool-call":
				// A Tool node's call reads as one tool row, like an agent's.
				push({
					...base,
					kind: "tool",
					key: `tool-call:${entry.seq}`,
					toolCallId: String(entry.seq),
					name: event.tool,
					connection: event.connection,
					input: event.arguments,
					hasInput: true,
				});
				break;
			case "tool-called": {
				const result =
					event.data !== null
						? JSON.stringify(event.data, null, 2)
						: event.text;
				let open: ToolItem | undefined;
				for (let at = items.length - 1; at >= 0 && !open; at--) {
					const candidate = items[at];
					if (
						candidate?.kind === "tool" &&
						candidate.connection !== undefined &&
						candidate.result === undefined
					) {
						open = candidate;
					}
				}
				if (open) {
					update<ToolItem>(open.key, (item) => ({
						...item,
						result,
						failed: event.isError,
					}));
				} else {
					push({
						...base,
						kind: "tool",
						key: `tool-called:${entry.seq}`,
						toolCallId: String(entry.seq),
						name: "",
						connection: "",
						hasInput: false,
						result,
						failed: event.isError,
					});
				}
				break;
			}
		}
	}

	return {
		items,
		index,
		...(lastAt !== undefined ? { lastAt } : {}),
		...(openThought !== undefined ? { openThought } : {}),
		...(changes !== undefined ? { changes } : {}),
	};
}

/**
 * The call that started a subagent, with one more event of the subagent
 * folded into its steps: text and thinking join by message, a tool call's
 * parts by its id. A step that follows a thought ends it.
 */
function withSubagentStep(item: ToolItem, entry: TranscriptEntry): ToolItem {
	const event = entry.event;
	const steps = (item.steps ?? []).slice();
	const at = (key: string) => steps.findIndex((step) => step.key === key);
	const base = { sessionId: entry.sessionId, at: entry.at };
	const last = steps.at(-1);
	const thoughtKey =
		event.type === "thinking"
			? `thinking:${entry.sessionId}:${event.messageId}`
			: undefined;
	if (last?.kind === "thinking" && !last.done && last.key !== thoughtKey) {
		steps[steps.length - 1] = { ...last, done: true };
	}
	switch (event.type) {
		case "text":
		case "thinking": {
			const key = thoughtKey ?? `message:${entry.sessionId}:${event.messageId}`;
			const found = at(key);
			const step = steps[found];
			if (step && step.kind !== "tool") {
				steps[found] = {
					...step,
					text: step.text + event.delta,
					...(step.kind === "thinking" ? { endedAt: entry.at } : {}),
				};
			} else if (event.type === "text") {
				steps.push({ ...base, kind: "message", key, text: event.delta });
			} else {
				steps.push({
					...base,
					kind: "thinking",
					key,
					text: event.delta,
					startedAt: item.lastAt ?? item.at,
					endedAt: entry.at,
					done: false,
				});
			}
			break;
		}
		case "tool-start":
		case "tool-end":
		case "tool-result": {
			const key = `tool:${entry.sessionId}:${event.toolCallId}`;
			const found = at(key);
			const step: ToolItem =
				found >= 0 && steps[found]?.kind === "tool"
					? (steps[found] as ToolItem)
					: {
							...base,
							kind: "tool",
							key,
							toolCallId: event.toolCallId,
							name: event.type === "tool-result" ? "tool" : event.name,
							hasInput: false,
						};
			const next: ToolItem =
				event.type === "tool-start"
					? step
					: event.type === "tool-end"
						? { ...step, name: event.name, input: event.input, hasInput: true }
						: {
								...step,
								result: event.content,
								endedAt: entry.at,
								...(event.isError ? { failed: true } : {}),
							};
			if (found >= 0) steps[found] = next;
			else steps.push(next);
			break;
		}
		default:
			return item;
	}
	return { ...item, steps, lastAt: entry.at };
}

/** "Thought for 12s", or "Thought" when it took less than a second. */
export function thoughtTitle(item: ThinkingItem): string {
	const ms = item.endedAt - item.startedAt;
	return ms < 1000 ? "Thought" : `Thought for ${formatDuration(ms)}`;
}

/** The fields of a tool's input that hold a file or folder path. */
const PATH_FIELDS = new Set([
	"file_path",
	"filePath",
	"path",
	"notebook_path",
	"absolute_path",
]);

/**
 * A one-line summary of a tool's input: the command, path, or pattern it
 * acts on. A path inside the project shows relative to `root`, the
 * project's folder. A search of the whole project names its pattern.
 */
export function summarizeToolInput(input: unknown, root?: string): string {
	if (input == null) return "";
	if (typeof input === "string") return input;
	if (typeof input !== "object") return String(input);
	const record = input as Record<string, unknown>;
	let atRoot = false;
	for (const field of [
		"command",
		"file_path",
		"filePath",
		"path",
		"notebook_path",
		"absolute_path",
		"pattern",
		"url",
		"query",
		"description",
		"prompt",
	]) {
		const value = record[field];
		if (typeof value !== "string" || value.length === 0) continue;
		if (!PATH_FIELDS.has(field)) return value;
		const path = projectPath(value, root);
		if (path !== "") return path;
		atRoot = true;
	}
	// The input names the project's folder and nothing else.
	if (atRoot) return ".";
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
