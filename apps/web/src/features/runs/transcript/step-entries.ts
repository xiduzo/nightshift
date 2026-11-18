import { lastWorktreeChanges } from "@nightshift/client";

import type { TranscriptEntry } from "@/shared/api";
import { withSubagentStep } from "./subagent-step";
import type {
	GateOpenItem,
	MessageItem,
	SessionItem,
	ThinkingItem,
	ToolItem,
	TranscriptItem,
	WebRequestItem,
} from "./transcript-items";
import type { TranscriptState } from "./transcript-state";

/** The Gate that opened last: the one a gate-resolved entry answers. */
function lastGateOpen(items: TranscriptItem[]): GateOpenItem | undefined {
	for (let at = items.length - 1; at >= 0; at--) {
		const item = items[at];
		if (item?.kind === "gate-open") return item;
	}
	return undefined;
}

/**
 * Folds the entries of one step into its items, in the order they came.
 * `applyEntries` (`transcript.ts`) calls it per step. The comment there
 * says what each kind of step gets.
 */
export function applyStepEntries(
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
			case "convert":
				push({
					...base,
					kind: "convert",
					key: `convert:${entry.seq}`,
					from: event.from,
					to: event.to,
					bytes: event.bytes,
					problem: event.problem,
				});
				break;
			case "web-request":
				push({
					...base,
					kind: "web-request",
					key: `web-request:${entry.seq}`,
					method: event.method,
					url: event.url,
				});
				break;
			case "web-response": {
				let open: WebRequestItem | undefined;
				for (let at = items.length - 1; at >= 0 && !open; at--) {
					const candidate = items[at];
					if (
						candidate?.kind === "web-request" &&
						candidate.status === undefined
					) {
						open = candidate;
					}
				}
				if (open) {
					update<WebRequestItem>(open.key, (item) => ({
						...item,
						status: event.status,
						text: event.text,
						bytes: event.bytes,
					}));
				}
				break;
			}
			case "service":
				push({
					...base,
					kind: "service",
					key: `service:${entry.seq}`,
					state: event.state,
					command: event.command ?? null,
					reason: event.reason ?? null,
				});
				break;
			case "since-last-run":
				push({
					...base,
					kind: "since-last-run",
					key: `since-last-run:${entry.seq}`,
					new: event.new,
					changed: event.changed,
					same: event.same,
					firstRun: event.firstRun,
					remembers: event.remembers,
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
