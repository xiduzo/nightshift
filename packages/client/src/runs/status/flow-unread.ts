import type { RunDetail } from "../types";

/** What a run page says when it has no flow to show. */
const WORDS = {
	older: {
		title: "This run is from an older version of Night Shift",
		body: "You can read its steps and costs. You cannot see its flow or run it again.",
	},
	newer: {
		title: "This run is from a newer version of Night Shift",
		body: "Update Night Shift to see its flow.",
	},
	invalid: {
		title: "Night Shift cannot read the flow of this run",
		body: "You can read its steps and costs. You cannot see its flow or run it again.",
	},
} as const;

/** Why the run has no flow to show, for a person. Null: it has one. */
export function flowUnreadWords(
	run: Pick<RunDetail, "flowUnread">,
): { title: string; body: string } | null {
	return run.flowUnread ? WORDS[run.flowUnread] : null;
}
