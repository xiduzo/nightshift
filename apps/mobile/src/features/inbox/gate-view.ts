import {
	type ContextItem,
	deadlineWhen,
	type GateLink,
	type OpenGate,
	urgencyOf,
	waitedText,
} from "@nightshift/client";

/**
 * What the Gate screen shows, without React Native: the parts of the
 * question, the hint over the run's steps, and the words of a link. Where
 * each choice leads, the confirm and the words after an answer are the
 * client's (`routeText`, `needsConfirm`, `sentText`).
 */

/** Longer text or code under its label. Code keeps the language of its fence. */
export type QuestionSection = {
	label: string;
	kind: "text" | "code";
	language?: string;
	value: string;
};

/** The longest text that shows as a tile under "At a glance". */
const GLANCE_MAX = 60;

/**
 * The parts of a Gate's question below its headline:
 * - `body`: the rest of the question, its paragraphs without a label.
 * - `glance`: short labelled values ("Branch: fix/login"), as tiles.
 * - `sections`: longer labelled text, and code with its language, each
 *   under its label.
 */
export function questionSections(context: readonly ContextItem[]): {
	body: string[];
	glance: { label: string; value: string }[];
	sections: QuestionSection[];
} {
	const body: string[] = [];
	const glance: { label: string; value: string }[] = [];
	const sections: QuestionSection[] = [];
	for (const item of context) {
		if (item.kind === "code") {
			sections.push({
				label: item.label ?? "Code",
				kind: "code",
				language: item.language,
				value: item.value,
			});
		} else if (item.label === null) {
			body.push(item.value);
		} else if (item.value.length <= GLANCE_MAX && !item.value.includes("\n")) {
			glance.push({ label: item.label, value: item.value });
		} else {
			sections.push({ label: item.label, kind: "text", value: item.value });
		}
	}
	return { body, glance, sections };
}

/** "4 steps · 12 min · $0.40": the hint over "What happened". */
export function stepsHint(
	count: number,
	took: string | null,
	cost: string | null,
): string {
	return [count === 1 ? "1 step" : `${count} steps`, took, cost]
		.filter((part): part is string => part !== null && part !== "")
		.join(" · ");
}

/** What a link in a question is, in a word: "Pull request". */
export const LINK_WORD: Record<GateLink["kind"], string> = {
	pull: "Pull request",
	issue: "Issue",
	ticket: "Ticket",
	web: "Web page",
};

/** The button that opens a link: "Open on GitHub". */
export function openLinkText(link: Pick<GateLink, "url" | "kind">): string {
	if (link.kind === "pull" || link.kind === "issue") return "Open on GitHub";
	return "Open in the browser";
}

/** A line that starts a Markdown block: a list item, a heading, a quote, a fence or a table row. */
const BLOCK_LINE = /^\s{0,3}([-*+]\s|\d+[.)]\s|#{1,6}\s|>|```|~~~|\|)/m;

/**
 * Whether a text has only inline Markdown (bold, links, code), so a
 * native text row shows it. A text with lists, headings, quotes, code
 * blocks or tables needs the full Markdown view.
 */
export function isInlineMarkdown(text: string): boolean {
	return !BLOCK_LINE.test(text);
}

/** A deadline this close counts down in minutes: "Answer in 14 min". */
const SOON_MS = 60 * 60_000;

/**
 * Why a Gate is urgent, at the top of the Gate: when you must answer, and
 * what happens when you do not. "Answer in 14 min" or "Answer by 07:30",
 * then "If you do not, Night Shift picks Keep." A Gate for now without a
 * deadline says that the run waits. Null for every other Gate.
 */
export function urgentText(
	gate: Pick<OpenGate, "deadline"> &
		Partial<Pick<OpenGate, "urgency" | "form">>,
	now: number,
): { title: string; description: string } | null {
	const { deadline } = gate;
	if (deadline) {
		const left = deadline.at - now;
		const { time, day } = deadlineWhen(deadline.at, now);
		const title =
			left <= 0
				? "Answer now"
				: left < SOON_MS
					? `Answer in ${waitedText(left)}`
					: `Answer by ${time}${day}`;
		const takes = gate.form
			? gate.form.default === undefined
				? "the step fails"
				: "Night Shift takes the default"
			: `Night Shift picks ${deadline.choose}`;
		return { title, description: `If you do not, ${takes}.` };
	}
	if (urgencyOf(gate) === "now") {
		return {
			title: "This needs you now",
			description: "The run waits until you answer.",
		};
	}
	return null;
}
