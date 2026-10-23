import type {
	ChoiceRoute,
	ContextItem,
	GateChoice,
	GateLink,
} from "@nightshift/client";

/**
 * What the Gate screen shows, without React Native: the words for where
 * each choice leads, which choices need a confirm, the parts of the question, and the
 * words after an answer went.
 */

/**
 * Where a choice leads, in a few words: "Goes to Build", "Ends the run"
 * (the run finishes), "Stops the run" (the path reached its limit: the
 * run stops, and you can resume it).
 */
export function routeText(route: ChoiceRoute | undefined): string | null {
	switch (route?.kind) {
		case "node":
			return `Goes to ${route.label}`;
		case "end":
			return "Ends the run";
		case "limit":
			return "Stops the run";
		default:
			return null;
	}
}

/** Why a choice stops the run, under its card. */
export function routeNote(route: ChoiceRoute | undefined): string | null {
	return route?.kind === "limit" ? "This path reached its limit." : null;
}

/** The words of the confirm before a red choice, or one that ends or stops the run. */
export function confirmText(
	route: ChoiceRoute | undefined,
	choiceName: string,
	runTitle: string,
): { title: string; body: string } {
	switch (route?.kind) {
		case "end":
			return {
				title: "End the run?",
				body: `This answer ends the run ${runTitle}.`,
			};
		case "limit":
			return {
				title: "Stop the run?",
				body: `This path reached its limit. This answer stops the run ${runTitle}. You can resume it later.`,
			};
		case "node":
			return {
				title: `Send ${choiceName}?`,
				body: `${routeText(route)} in the run ${runTitle}.`,
			};
		default:
			return {
				title: `Send ${choiceName}?`,
				body: `The run ${runTitle} gets this answer.`,
			};
	}
}

/** A choice the flow author colored red: it stops work. */
export function isDestructive(choice: Pick<GateChoice, "color">): boolean {
	return choice.color === "red";
}

/** The person confirms first: a red choice, or one that ends or stops the run. */
export function needsConfirm(
	choice: Pick<GateChoice, "color">,
	route: ChoiceRoute | undefined,
): boolean {
	return (
		isDestructive(choice) || route?.kind === "end" || route?.kind === "limit"
	);
}

/** What happens once the answer went: "Fix the bug goes on at Build". */
export function sentText(
	route: ChoiceRoute | undefined,
	runTitle: string,
	walkerElsewhere: string | null,
): string {
	if (route?.kind === "end") return "The run ends.";
	if (route?.kind === "limit") return "The run stops.";
	const goesOn =
		route?.kind === "node"
			? `${runTitle} goes on at ${route.label}`
			: `${runTitle} goes on`;
	if (walkerElsewhere) return `${goesOn} when ${walkerElsewhere} is online.`;
	// A step label may end in its own mark: "Announce it?".
	return /[.?!]$/.test(goesOn) ? goesOn : `${goesOn}.`;
}

/** The longest text that shows as a tile under "At a glance". */
const GLANCE_MAX = 60;

/**
 * The parts of a Gate's question below its headline:
 * - `body`: the rest of the question, its paragraphs without a label.
 * - `glance`: short labelled values ("Branch: fix/login"), as tiles.
 * - `sections`: longer labelled text, and code, each under its label.
 */
export function questionSections(context: readonly ContextItem[]): {
	body: string[];
	glance: { label: string; value: string }[];
	sections: { label: string; kind: "text" | "code"; value: string }[];
} {
	const body: string[] = [];
	const glance: { label: string; value: string }[] = [];
	const sections: { label: string; kind: "text" | "code"; value: string }[] =
		[];
	for (const item of context) {
		if (item.kind === "code") {
			sections.push({
				label: item.label ?? "Code",
				kind: "code",
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
