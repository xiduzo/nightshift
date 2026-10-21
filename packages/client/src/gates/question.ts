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

/**
 * Splits a rendered question into the question itself (its first paragraph)
 * and the context after it. Fenced code becomes a code item; a paragraph
 * that opens with a `Label:` line becomes a labelled item. Display only: the
 * text stays exactly what the flow rendered.
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
			blocks.push({ label: null, kind: "text", value: trimmed });
		}
	};
	let last = 0;
	for (const match of question.matchAll(FENCE)) {
		pushText(question.slice(last, match.index));
		blocks.push({
			label: null,
			kind: "code",
			language: match[1] || undefined,
			value: match[2] ?? "",
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
			const label = previous?.kind === "text" ? labelOnly(previous) : null;
			if (previous && label) context.pop();
			context.push({ ...block, label: label ?? block.language ?? null });
			continue;
		}
		const [firstLine = "", ...rest] = block.value.split("\n");
		const label = LABEL_LINE.exec(firstLine)?.[1] ?? null;
		context.push(
			label && rest.length > 0
				? { label, kind: "text", value: rest.join("\n").trim() }
				: block,
		);
	}
	return { headline: first.value, context };
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
