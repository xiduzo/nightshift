import type { TranscriptEntry } from "../log";

/**
 * A step's transcript as plain lines, for an agent that reads a run: the
 * Improver's tools, the Explainer, and the Learner's evidence (ADR 37).
 * Text comes whole, a tool call as one line, a command's output as it
 * was. Only the last `maxLines` stay.
 */

const cut = (text: string, max: number) =>
	text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** The last `maxLines` lines of a transcript, in plain text, oldest first. */
export function transcriptLines(
	entries: readonly TranscriptEntry[],
	maxLines: number,
): string[] {
	const lines: string[] = [];
	let text = "";
	const push = (line: string) => {
		if (text !== "") {
			lines.push(...text.trim().split("\n"));
			text = "";
		}
		if (line !== "") lines.push(line);
		if (lines.length > maxLines * 2) {
			lines.splice(0, lines.length - maxLines);
		}
	};
	for (const { event } of entries) {
		if (event.type === "text") text += event.delta;
		else push(lineOf(event));
	}
	push("");
	return lines.slice(-maxLines);
}

/** One transcript event as a line. Empty: not worth a line. */
function lineOf(event: TranscriptEntry["event"]): string {
	switch (event.type) {
		case "tool-end":
			return `> ${event.name} ${cut(JSON.stringify(event.input ?? {}), 200)}`;
		case "tool-result":
			return `${event.isError ? "tool error: " : ""}${cut(event.content.trim(), 300)}`;
		case "report":
			return `Report (${event.outcome || "no outcome"}): ${cut(event.summary, 500)}`;
		case "error":
			return `Error: ${event.message}`;
		case "command-start":
			return `$ ${event.command}`;
		case "command-output":
			return event.text.trimEnd();
		case "command-exit":
			return `Exit code: ${event.exitCode ?? "none"}`;
		case "decision":
			return `Decision: ${event.label}. ${cut(event.notes, 300)}`;
		case "gate-resolved":
			return `Answer: ${event.choice}${event.note ? `. ${event.note}` : ""}`;
		case "value":
			return event.problem ? `Value problem: ${event.problem}` : "";
		case "convert":
			return event.problem
				? `Convert ${event.from} to ${event.to} failed: ${event.problem}`
				: `Converted ${event.from} to ${event.to} (${event.bytes} bytes)`;
		case "tool-called":
			return `${event.isError ? "tool error: " : ""}${cut(event.text, 300)}`;
		case "wait":
			return `Waits: ${event.message}`;
		case "item-end":
			return event.reason ? `Item ${event.state}: ${event.reason}` : "";
		case "end":
			return `End: ${event.status}${event.message ? `. ${event.message}` : ""}`;
		case "service":
			return event.state === "starting"
				? `Service: start ${event.command ?? ""}`.trim()
				: event.state === "ready"
					? "Service: ready"
					: `Service: failed${event.reason ? `. ${event.reason}` : ""}`;
		case "lease":
			return event.held
				? `Lease: took ${event.name}`
				: `Lease: ${event.name} is held by run ${event.holder ?? "unknown"}`;
		case "since-last-run":
			return `Since last run: ${event.new} new, ${event.changed} changed, ${event.same} the same${event.firstRun ? " (first run)" : ""}${event.remembers ? "" : ", remembers nothing"}`;
		case "web-request":
			return `Web request: ${event.method} ${cut(event.url, 300)}`;
		case "web-response":
			return event.status === null
				? `Web response: none. ${event.text}`
				: `Web response: ${event.status} ${event.text}`.trim();
		// Not worth a line: the text and the thinking come as deltas, the
		// rest is the start of what a line above shows, or bookkeeping.
		case "text":
		case "thinking":
		case "session":
		case "tool-start":
		case "usage":
		case "finished":
		case "decision-start":
		case "rule":
		case "gate-open":
		case "items-read":
		case "item-start":
		case "wake":
		case "value-start":
		case "tool-call":
		case "worktree-snapshot":
		case "worktree-changes":
			return "";
		default:
			return unknownKind(event);
	}
}

/**
 * An event kind this build does not know, from a newer Night Shift: no
 * line. Its type is `never`, so a kind added to `StepEvent` fails to
 * compile until `lineOf` gives it words or none.
 */
function unknownKind(_event: never): string {
	return "";
}
