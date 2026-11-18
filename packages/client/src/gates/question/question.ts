import { extractGateLinks, type GateLink } from "./links";

/** One labelled piece of what a Gate shows below its question. */
export type ContextItem = {
	label: string | null;
	kind: "text" | "code";
	/** The fence's language, for code. */
	language?: string;
	value: string;
};

const FENCE = /```([\w+-]*)[^\n]*\n([\s\S]*?)(?:\n```|$)/g;
/** A line that is only a label: `Diff:`, `Plan summary:`. */
const LABEL_LINE = /^([^\n:]{1,48}):\s*$/;
/** A label and a JSON value on one line: `Result: {"ok": true}`. */
const LABELLED_JSON = /^([^\n:{["]{1,48}):\s*([[{].*)$/;
/** Where JSON may open inside prose: `[{`, `["`, `[[` or `{"`. */
const JSON_START = /\[(?=\s*[{"[])|\{(?=\s*")/g;
/** The `Label:` that ends the text before a value: `… Open findings:`. */
const TRAILING_LABEL = /(?:^|[.!?:]\s+)([^\n:.!?]{1,48}):\s*$/;
/** JSON shorter than this stays in its sentence. */
const INLINE_JSON = 60;

/**
 * A JSON object or array, pretty-printed, or null for anything else. A
 * template puts an object in a question as JSON on one line.
 */
function prettyJson(text: string): string | null {
	const trimmed = text.trim();
	if (!/^[[{]/.test(trimmed)) return null;
	try {
		return JSON.stringify(JSON.parse(trimmed), null, 2);
	} catch {
		return null;
	}
}

/** The end (exclusive) of the bracketed span that opens at `start`, or -1. */
function bracketEnd(text: string, start: number): number {
	let depth = 0;
	let inString = false;
	for (let i = start; i < text.length; i++) {
		const c = text[i];
		if (inString) {
			if (c === "\\") i++;
			else if (c === '"') inString = false;
		} else if (c === '"') inString = true;
		else if (c === "{" || c === "[") depth++;
		else if (c === "}" || c === "]") {
			depth--;
			if (depth === 0) return i + 1;
		}
	}
	return -1;
}

/**
 * A paragraph of prose with long JSON inside it, as text and `json` code
 * items in order. A template that puts an object in a sentence writes it
 * as JSON on one line. The `Label:` right before the JSON names it.
 */
function splitJson(paragraph: string): ContextItem[] {
	const items: ContextItem[] = [];
	let rest = paragraph;
	for (;;) {
		let found: { at: number; end: number; json: string } | null = null;
		for (const match of rest.matchAll(JSON_START)) {
			const end = bracketEnd(rest, match.index);
			if (end - match.index < INLINE_JSON) continue;
			const json = prettyJson(rest.slice(match.index, end));
			if (json !== null) {
				found = { at: match.index, end, json };
				break;
			}
		}
		if (found === null) break;
		let before = rest.slice(0, found.at);
		const label = TRAILING_LABEL.exec(before);
		if (label?.[1]) {
			before = before.slice(0, label.index + label[0].indexOf(label[1]));
		}
		before = before.trim();
		if (before !== "") items.push({ label: null, kind: "text", value: before });
		items.push({
			label: label?.[1]?.trim() ?? null,
			kind: "code",
			language: "json",
			value: found.json,
		});
		rest = rest.slice(found.end).replace(/^[\s.,;]+/, "");
	}
	const after = rest.trim();
	if (after !== "") items.push({ label: null, kind: "text", value: after });
	return items;
}

/**
 * Splits a rendered question into the question itself (its first paragraph)
 * and the context after it. The context is Markdown. Fenced code becomes a
 * code item; a paragraph that opens with a `Label:` line becomes a labelled
 * item; paragraphs without a label stay together, so a list or a heading
 * keeps its text. JSON, fenced or not, becomes a pretty-printed `json` code
 * item, also long JSON inside a sentence. Display only: the flow's text is
 * not changed.
 */
export function parseGateQuestion(question: string): {
	headline: string;
	context: ContextItem[];
} {
	const blocks: ContextItem[] = [];
	const pushText = (text: string) => {
		for (const paragraph of text.split(/\n\s*\n/)) {
			const trimmed = paragraph.trim();
			if (trimmed === "") continue;
			// The headline stays whole.
			if (blocks.length === 0) {
				blocks.push({ label: null, kind: "text", value: trimmed });
			} else {
				blocks.push(...splitJson(trimmed));
			}
		}
	};
	let last = 0;
	for (const match of question.matchAll(FENCE)) {
		pushText(question.slice(last, match.index));
		const code = match[2] ?? "";
		const language = match[1] || undefined;
		const json =
			language === undefined || language === "json" ? prettyJson(code) : null;
		blocks.push({
			label: null,
			kind: "code",
			language: json === null ? language : "json",
			value: json ?? code,
		});
		last = match.index + match[0].length;
	}
	pushText(question.slice(last));

	const first = blocks[0];
	if (first?.kind !== "text") {
		return { headline: question.trim(), context: [] };
	}

	const context: ContextItem[] = [];
	for (const block of blocks.slice(1)) {
		if (block.kind === "code") {
			// "Diff:" right above a fence names the fence.
			const previous = context.at(-1);
			const above =
				block.label === null && previous?.kind === "text"
					? takeLastLabel(previous)
					: null;
			if (previous && above && previous.value === "") context.pop();
			context.push({
				...block,
				label: block.label ?? above ?? block.language ?? null,
			});
			continue;
		}
		const [firstLine = "", ...rest] = block.value.split("\n");
		const inline = LABELLED_JSON.exec(block.value);
		const inlineJson = inline?.[2] ? prettyJson(inline[2]) : null;
		if (inline?.[1] && inlineJson !== null) {
			context.push(jsonItem(inline[1], inlineJson));
			continue;
		}
		const label = LABEL_LINE.exec(firstLine)?.[1] ?? null;
		const value = label && rest.length > 0 ? rest.join("\n").trim() : null;
		const json = prettyJson(value ?? block.value);
		if (json !== null) {
			context.push(jsonItem(value === null ? null : label, json));
			continue;
		}
		if (value !== null) {
			context.push({ label, kind: "text", value });
			continue;
		}
		// A paragraph without a label goes on the Markdown before it.
		const previous = context.at(-1);
		if (
			previous?.kind === "text" &&
			previous.label === null &&
			!labelOnly(previous) &&
			!labelOnly(block)
		) {
			previous.value = `${previous.value}\n\n${block.value}`;
			continue;
		}
		context.push(block);
	}
	for (const item of context) {
		if (item.kind === "text") item.value = keepLineBreaks(item.value);
	}
	return { headline: first.value, context };
}

/**
 * Takes a `Label:` last line off a text item and returns the label. The
 * item's value is "" when the label was all it held.
 */
function takeLastLabel(item: ContextItem): string | null {
	const lines = item.value.split("\n");
	const label = LABEL_LINE.exec(lines.at(-1) ?? "")?.[1] ?? null;
	if (label === null || (item.label !== null && lines.length === 1)) {
		return null;
	}
	item.value = lines.slice(0, -1).join("\n").trim();
	return label;
}

/** A line that starts a Markdown block of its own: a list item, a heading. */
const BLOCK_LINE = /^\s*(?:[-*+]\s|\d+[.)]\s|#{1,6}\s|>|\||```|~~~)/;

/**
 * A flow writes one fact per line ("Approver: …", then "Builder: …").
 * Markdown joins such lines into one. A hard break (two spaces) keeps
 * each on its own line. Lists, headings and tables keep their Markdown.
 */
function keepLineBreaks(text: string): string {
	const lines = text.split("\n");
	return lines
		.map((line, index) => {
			const next = lines[index + 1];
			if (next === undefined || line.trim() === "" || next.trim() === "") {
				return line;
			}
			if (BLOCK_LINE.test(next) || line.trimStart().startsWith("|")) {
				return line;
			}
			return `${line.trimEnd()}  `;
		})
		.join("\n");
}

function jsonItem(label: string | null, value: string): ContextItem {
	return { label: label ?? "json", kind: "code", language: "json", value };
}

function labelOnly(item: ContextItem): string | null {
	if (item.label !== null || item.value.includes("\n")) return null;
	return LABEL_LINE.exec(item.value)?.[1] ?? null;
}

/**
 * What a Gate shows: the question itself, the context below it, and the
 * links to check before answering.
 */
export function gateParts(question: string): {
	headline: string;
	context: ContextItem[];
	links: GateLink[];
} {
	const { links, question: rest } = extractGateLinks(question);
	return { ...parseGateQuestion(rest), links };
}
