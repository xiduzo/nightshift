import type { FlowInput } from "../../flow";
import {
	ACCEPTED_LEARNINGS_DIR,
	IS_PROPOSED_LEARNING_SHELL,
	PROPOSED_LEARNINGS_DIR,
} from "./layout";
import { LEARNINGS_GATE_TEXT_AWK } from "./learning-file";

/** The start of each command: the proposed learnings, the accepted ones, and the rule for a name. */
const LEARNINGS = String.raw`set -e
if [ -z "$NS_KNOWLEDGE" ]; then echo "Run this kit in a flow: the step gets the project's knowledge folder there." >&2; exit 2; fi
proposed="$NS_KNOWLEDGE/${PROPOSED_LEARNINGS_DIR}"
accepted="$NS_KNOWLEDGE/${ACCEPTED_LEARNINGS_DIR}"
${IS_PROPOSED_LEARNING_SHELL}`;

/**
 * Keep or Delete, for each proposed learning the Gate showed. The second
 * form of `settle` of the engine's Learnings module: what it refuses, this
 * skips. `learnings-kit.test.ts` of the engine runs both over the same
 * folders. `set -f`: a name is never a pattern. The names split on spaces,
 * and the rule lets no space through.
 */
function eachShown(action: string): string {
	return String.raw`${LEARNINGS}
set -f
for name in {{list.data.files}}; do
	is_proposed_learning "$name" || continue
	[ -f "$proposed/$name" ] || continue
${action}
done`;
}

/**
 * `kit:knowledge/review-learnings`: a Gate with what agents proposed to
 * learn about the project. Keep moves the proposals into
 * `learnings/accepted/`, where agents read them; delete removes them.
 * Only the files the Gate showed change: a proposal that came in while it
 * waited stays for the next review.
 */
export const knowledgeReviewLearningsKit: FlowInput = {
	version: 8,
	description:
		"Shows what agents proposed to learn about the project, and asks you to keep or delete it. Agents read what you keep.",
	inputs: [],
	outputs: [],
	start: "list",
	nodes: [
		{
			id: "list",
			type: "command",
			label: "Find the proposals",
			position: { x: 0, y: 0 },
			command: String.raw`${LEARNINGS}
files=""
for file in "$proposed"/*.md; do
	[ -f "$file" ] || continue
	name=$(basename "$file")
	is_proposed_learning "$name" || continue
	files="$files $name"
done
if [ -z "$files" ]; then
	printf '{"outcome": "none"}' > "$NS_OUTPUT"
	exit 0
fi
text=$(cd "$proposed" && awk '${LEARNINGS_GATE_TEXT_AWK}' $files)
printf '{"files": "%s", "text": "%s"}' "$files" "$text" > "$NS_OUTPUT"`,
			exits: [
				{ name: "review", code: 0, color: "green" },
				{ name: "none", code: "data", color: "gray" },
				{ name: "fail", color: "red" },
			],
		},
		{
			id: "confirm",
			type: "decision",
			label: "Keep them?",
			position: { x: 300, y: 0 },
			prompt:
				"Agents propose to learn this about the project:\n\n{{list.data.text}}\n\nKeep it? Agents read what you keep in later runs.",
			options: [
				{
					name: "keep",
					description: "Add it to the project's knowledge.",
				},
				{ name: "delete", description: "Delete it." },
			],
			by: "person",
		},
		{
			id: "keep",
			type: "command",
			label: "Keep them",
			position: { x: 600, y: -60 },
			command: eachShown(String.raw`	mkdir -p "$accepted"
	cat "$proposed/$name" >> "$accepted/$name"
	rm -f "$proposed/$name"`),
		},
		{
			id: "delete",
			type: "command",
			label: "Delete them",
			position: { x: 600, y: 60 },
			command: eachShown(String.raw`	rm -f "$proposed/$name"`),
		},
		{
			id: "kept",
			type: "end",
			position: { x: 900, y: -60 },
			status: "done",
			message: "The learnings are in the project's knowledge",
		},
		{
			id: "deleted",
			type: "end",
			position: { x: 900, y: 60 },
			status: "done",
			message: "The learnings are deleted",
		},
		{
			id: "nothing",
			type: "end",
			position: { x: 300, y: 180 },
			status: "done",
			message: "No learnings wait for you",
		},
		{
			id: "not_found",
			type: "end",
			position: { x: 300, y: 300 },
			status: "failed",
			message: "Could not read the learnings",
		},
	],
	edges: [
		{ id: "list-review", from: "list", outcome: "review", to: "confirm" },
		{ id: "list-none", from: "list", outcome: "none", to: "nothing" },
		{ id: "list-fail", from: "list", outcome: "fail", to: "not_found" },
		{ id: "confirm-keep", from: "confirm", outcome: "keep", to: "keep" },
		{
			id: "confirm-delete",
			from: "confirm",
			outcome: "delete",
			to: "delete",
		},
		{ id: "keep-pass", from: "keep", outcome: "pass", to: "kept" },
		{ id: "delete-pass", from: "delete", outcome: "pass", to: "deleted" },
	],
};
