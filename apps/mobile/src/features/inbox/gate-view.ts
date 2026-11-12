import type { ContextItem, GateLink } from "@nightshift/client";

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
