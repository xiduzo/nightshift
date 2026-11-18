import type { TranscriptEntry } from "@/shared/api";
import type { ToolItem } from "./transcript-items";

/**
 * The call that started a subagent, with one more event of the subagent
 * folded into its steps: text and thinking join by message, a tool call's
 * parts by its id. A step that follows a thought ends it.
 *
 * `applyStepEntries` (`step-entries.ts`) calls it for an entry that names
 * the call it belongs to.
 */
export function withSubagentStep(
	item: ToolItem,
	entry: TranscriptEntry,
): ToolItem {
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
