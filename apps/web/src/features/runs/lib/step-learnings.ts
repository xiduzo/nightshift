import type { TranscriptItem } from "../transcript/transcript-items";

/**
 * What a step proposed to learn, in the words of the Gate that reviews it
 * (`kit:knowledge/review-learnings`).
 */
export const LEARNINGS_TITLE = "Proposes to learn this about the project";

/** What happens to the proposals next, as the Gate says it. */
export const LEARNINGS_NEXT =
	"You keep or delete it in Review learnings. Agents read what you keep in later runs.";

/**
 * The notes the step's agent proposed to learn, from its reports, in order.
 * Each note on one line and without the empty ones, as they are kept.
 */
export function stepLearnings(items: readonly TranscriptItem[]): string[] {
	return items.flatMap((item) =>
		item.kind === "report"
			? (item.learnings ?? [])
					.map((note) => note.replace(/\s+/g, " ").trim())
					.filter((note) => note !== "")
			: [],
	);
}
