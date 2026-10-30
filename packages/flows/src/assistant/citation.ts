/**
 * How the assistant cites a step of the run a chat is about: a Markdown
 * link to `#step-<stepId>`, such as `[critic](#step-1f0c…)`. A fragment,
 * not a protocol: a Markdown renderer keeps it, where it drops an unknown
 * protocol such as `step:`. The chat shows the link as an inline citation.
 */

const PREFIX = "#step-";

/** The Markdown link that cites step `stepId` as `label`. */
export function stepCitation(label: string, stepId: string): string {
	return `[${label.replace(/[[\]]/g, "")}](${PREFIX}${stepId})`;
}

/** The step id a link target cites, or undefined when it cites none. */
export function citedStepId(href: string | undefined): string | undefined {
	if (!href?.startsWith(PREFIX)) return undefined;
	const id = href.slice(PREFIX.length).trim();
	return /^[\w-]+$/.test(id) ? id : undefined;
}
