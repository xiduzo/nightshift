import type { FlowInput } from "../../flow";
import { COUNT_FILES, folderInput, KNOWLEDGE_DEST, syncEnds } from "./shell";

/**
 * Jira's description (Atlassian Document Format) as plain text, and a work
 * item as one markdown file. No single quotes: it goes in `jq '…'`.
 */
const WORK_ITEM_MARKDOWN = String.raw`def adf: if type == "string" then . elif type == "array" then map(adf) | join("") elif type == "object" then (if .type == "text" then .text elif .type == "hardBreak" then "\n" else ((.content // []) | map(adf) | join("")) + (if (.type == "paragraph" or .type == "heading" or .type == "codeBlock" or .type == "blockquote" or .type == "listItem") then "\n\n" else "" end) end) else "" end; "# \(.key): \(.fields.summary // "")\n\nType: \(.fields.issuetype.name // "")\nStatus: \(.fields.status.name // "")\n\n\(.fields.description | adf)"`;

/**
 * `kit:knowledge/jira`: Jira work items as markdown in the project's
 * knowledge, with the Atlassian CLI (`acli`) and `jq`.
 */
export const knowledgeJiraKit: FlowInput = {
	version: 7,
	description:
		"Copies Jira work items into the project's knowledge as markdown, one file each. Needs a CLI tool that runs the Atlassian CLI signed in, and jq.",
	inputs: [
		{
			name: "keys",
			type: "text",
			description:
				"The work items, separated by spaces, commas or lines, for example PROJ-1, PROJ-2.",
			required: true,
		},
		{
			name: "tool",
			type: "text",
			description:
				"The CLI tool that runs acli signed in, for example acli-work. Each CLI tool with a login is one account.",
			default: "acli",
		},
		folderInput("jira"),
	],
	start: "sync",
	...withSync(),
};

function withSync(): Pick<FlowInput, "nodes" | "edges" | "outputs"> {
	const ends = syncEnds("Work items synced");
	return {
		...ends,
		nodes: [
			{
				id: "sync",
				type: "command",
				label: "Copy the work items",
				position: { x: 0, y: 0 },
				command: String.raw`${KNOWLEDGE_DEST}
if ! command -v jq >/dev/null; then echo "Install jq: this kit turns the work items into markdown with it." >&2; exit 2; fi
tool="{{tool}}"
keys="{{keys}}"
mkdir -p "$dest"
# Split the list, but never read a pattern in it.
set -f
for key in $(printf '%s' "$keys" | tr ',' ' '); do
	"$tool" jira workitem view "$key" --json > "$dest/$key.json.part"
	jq -r '${WORK_ITEM_MARKDOWN}' "$dest/$key.json.part" > "$dest/$key.md"
	rm -f "$dest/$key.json.part"
done
${COUNT_FILES}`,
				exits: [
					{ name: "synced", code: 0, color: "green" },
					{ name: "fail", color: "red" },
				],
			},
			...(ends.nodes ?? []),
		],
	};
}
