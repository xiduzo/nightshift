import type { StepSummary } from "@/shared/api";
import { LEARNINGS_TITLE, stepLearnings } from "../lib/step-learnings";
import { thoughtTitle } from "./transcript";
import type { TranscriptItem } from "./transcript-items";

/**
 * A step's transcript as Markdown, to paste in a chat, an issue or a pull
 * request. Prompts, messages, tool calls, logs and answers keep their text;
 * long tool results and logs are cut at the end, with a note.
 */

/** How an End step ends the run, in words. */
const END_WORDS: Record<
	Extract<TranscriptItem, { kind: "end" }>["status"],
	string
> = {
	done: "done",
	"nothing-to-do": "nothing to do",
	failed: "failed",
};

/** Tool results and command logs longer than this are cut, so a paste stays readable. */
const MAX_BLOCK_CHARS = 4000;

/** A code fence longer than any run of backticks in the text, so the text cannot close it. */
export function fence(text: string, lang = ""): string {
	const longest = Math.max(
		0,
		...(text.match(/`+/g) ?? []).map((run) => run.length),
	);
	const marks = "`".repeat(Math.max(3, longest + 1));
	return `${marks}${lang}\n${text.replace(/\n$/, "")}\n${marks}`;
}

function cut(text: string): string {
	if (text.length <= MAX_BLOCK_CHARS) return text;
	const left = text.length - MAX_BLOCK_CHARS;
	return `${text.slice(0, MAX_BLOCK_CHARS)}\n… (${left} more characters)`;
}

function json(value: unknown): string {
	return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function quote(text: string): string {
	return text
		.trim()
		.split("\n")
		.map((line) => (line ? `> ${line}` : ">"))
		.join("\n");
}

type Context = {
	/** The session's prompt and its number in the step, by session id. */
	sessions: ReadonlyMap<string, { prompt: string; number: number }>;
	/** Item titles of a Call step, by item id. */
	itemTitles: ReadonlyMap<string, string>;
};

/** One transcript item as Markdown. Empty for items that add nothing to a paste. */
export function itemToMarkdown(item: TranscriptItem, context: Context): string {
	switch (item.kind) {
		case "session": {
			const session = context.sessions.get(item.sessionId);
			const title = `**Session${session ? ` ${session.number}` : ""}**${item.model ? ` · ${item.model}` : ""}`;
			return session?.prompt ? `${title}\n\n${quote(session.prompt)}` : title;
		}
		case "message":
			return item.text.trim();
		case "thinking":
			return `**${thoughtTitle(item)}**\n\n${quote(item.text.trim())}`;
		case "tool": {
			const name = item.connection
				? `${item.connection} → ${item.name}`
				: item.name;
			const parts = [`**Tool** \`${name}\`${item.failed ? " (failed)" : ""}`];
			if (item.input !== undefined)
				parts.push(fence(cut(json(item.input)), "json"));
			if (item.result) parts.push(fence(cut(item.result)));
			// A subagent's work follows the call that started it.
			const steps = (item.steps ?? [])
				.map((step) => itemToMarkdown(step, context))
				.filter((text) => text !== "");
			if (steps.length > 0) parts.push(quote(steps.join("\n\n")));
			return parts.join("\n\n");
		}
		case "report": {
			const parts = [`**Report:** \`${item.outcome}\``];
			if (item.summary.trim()) parts.push(item.summary.trim());
			if (item.data !== undefined) parts.push(fence(json(item.data), "json"));
			const learnings = stepLearnings([item]);
			if (learnings.length > 0) {
				parts.push(
					`**${LEARNINGS_TITLE}:**\n\n${learnings.map((note) => `- ${note}`).join("\n")}`,
				);
			}
			return parts.join("\n\n");
		}
		case "finished":
			return "_The session finished._";
		case "error":
			return `**Error** (${item.errorKind}): ${item.message}`;
		case "command":
			return fence(`$ ${item.command}`, "sh");
		case "log":
			return fence(cut(item.chunks.map((chunk) => chunk.text).join("")));
		case "exit":
			return item.exitCode === null
				? "_The command did not end with an exit code._"
				: `_Exit code ${item.exitCode}._`;
		case "decision-ask":
			return `**Asked ${item.model}** (options: ${item.labels.map((label) => `\`${label}\``).join(", ")})\n\n${quote(item.prompt)}`;
		case "decision":
			return `**Picked** \`${item.label}\`${item.notes.trim() ? `: ${item.notes.trim()}` : ""}`;
		case "rule":
			return item.matched
				? `**Rule picked** \`${item.matched}\``
				: "**No option matched.**";
		case "gate-open":
			return `**Question**\n\n${quote(item.question)}\n\nOptions: ${item.choices.map((choice) => `\`${choice.name}\``).join(", ")}`;
		case "gate-resolved":
			return `**${item.byDeadline ? "Picked at the deadline" : "Answer"}:** \`${item.choice}\`${item.note.trim() ? `\n\n${quote(item.note)}` : ""}`;
		case "end":
			return `**Ended:** ${END_WORDS[item.status]}${item.message ? `. ${item.message}` : ""}`;
		case "service":
			return item.state === "starting"
				? `**Service:** starts \`${item.command ?? ""}\``
				: item.state === "ready"
					? "**Service:** ready"
					: `**Service:** not ready${item.reason ? `. ${item.reason}` : ""}`;
		case "lease":
			return item.held
				? `**Lease:** took \`${item.name}\``
				: `**Lease:** \`${item.name}\` is busy${item.holderTitle ? `. ${item.holderTitle} holds it.` : ""}`;
		case "items-read":
			return `_Read ${item.count} items, ${item.open} still to do._`;
		case "item-start":
			return `**Item:** ${item.title}${item.branch ? ` (branch \`${item.branch}\`)` : ""}`;
		case "item-end": {
			const title = context.itemTitles.get(item.itemId) ?? item.itemId;
			return `**Item ${item.state}:** ${title}${item.reason ? `. ${item.reason}` : ""}`;
		}
		case "wait":
			return `_Waiting: ${item.message}_`;
		case "wake":
			return item.signal
				? `_Woke up on the signal \`${item.signal}\`._`
				: "_Woke up._";
		case "value-ask":
			return item.by === "rule"
				? fence(item.source)
				: `**Asked ${item.model ?? "the model"}**\n\n${quote(item.source)}`;
		case "value":
			return item.problem
				? `**No value:** ${item.problem}`
				: fence(json(item.data), "json");
	}
}

/** The context `itemToMarkdown` needs, from the step. */
export function markdownContext(
	step: StepSummary,
	itemTitles: ReadonlyMap<string, string>,
): Context {
	return {
		sessions: new Map(
			step.sessions.map((session, position) => [
				session.id,
				{ prompt: session.prompt ?? "", number: position + 1 },
			]),
		),
		itemTitles,
	};
}

/** The items as Markdown, under a heading that names the step. */
export function transcriptToMarkdown(
	step: StepSummary,
	items: readonly TranscriptItem[],
	context: Context,
): string {
	const visit = step.visit > 1 ? `, visit ${step.visit}` : "";
	const outcome = step.outcome ? ` → \`${step.outcome}\`` : "";
	const heading = `### Step \`${step.nodeId}\` (${step.nodeType}${visit})${outcome}`;
	const body = items
		.map((item) => itemToMarkdown(item, context))
		.filter((part) => part !== "");
	if (step.error) body.push(`**The step failed:** ${step.error}`);
	return [heading, ...body].join("\n\n");
}
