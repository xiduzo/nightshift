import type { FlowInput } from "../../flow";
import { COUNT_FILES, folderInput, KNOWLEDGE_DEST, syncEnds } from "./shell";

/** The secret the kit reads: an Atlassian API token. */
const TOKEN = "CONFLUENCE_API_TOKEN";

/**
 * A Confluence page (its storage format) as rough markdown: headings, list
 * items and line breaks kept, every other tag dropped. No single quotes:
 * it goes in `jq '…'`.
 */
const PAGE_MARKDOWN = String.raw`"# \(.title)\n\n" + ((.body.storage.value // "") | gsub("<h[1-6][^>]*>"; "\n## ") | gsub("<li[^>]*>"; "- ") | gsub("</(p|h[1-6]|li|tr|div|ul|ol|table|pre)>|<br ?/?>"; "\n") | gsub("<[^>]+>"; "") | gsub("&nbsp;"; " ") | gsub("&lt;"; "<") | gsub("&gt;"; ">") | gsub("&quot;"; "\"") | gsub("&amp;"; "&"))`;

/**
 * `kit:knowledge/confluence`: Confluence pages as markdown in the
 * project's knowledge, with `curl` on the REST API and `jq`. The API token
 * is a secret the command reads.
 */
export const knowledgeConfluenceKit: FlowInput = {
	version: 7,
	description: `Copies Confluence pages into the project's knowledge as markdown, one file each. Save an Atlassian API token as the secret ${TOKEN}. Needs jq.`,
	inputs: [
		{
			name: "site",
			label: "Site",
			type: "text",
			description: "Your Confluence site, for example your-team.atlassian.net.",
			required: true,
		},
		{
			name: "email",
			label: "Email",
			type: "text",
			description: "The email address of the account the API token is of.",
			required: true,
		},
		{
			name: "pages",
			label: "Pages",
			type: "text",
			description:
				"The page ids, separated by spaces, commas or lines. The id is the number in the address of the page.",
			required: true,
		},
		folderInput("confluence"),
	],
	start: "sync",
	...withSync(),
};

function withSync(): Pick<FlowInput, "nodes" | "edges" | "outputs"> {
	const ends = syncEnds("Pages synced");
	return {
		...ends,
		nodes: [
			{
				id: "sync",
				type: "command",
				label: "Copy the pages",
				position: { x: 0, y: 0 },
				secrets: [TOKEN],
				command: String.raw`${KNOWLEDGE_DEST}
if ! command -v jq >/dev/null; then echo "Install jq: this kit turns the pages into markdown with it." >&2; exit 2; fi
site=$(printf '%s' "{{site}}" | sed -e 's#^[A-Za-z]*://##' -e 's#/.*$##')
email="{{email}}"
pages="{{pages}}"
mkdir -p "$dest"
# Split the list, but never read a pattern in it.
set -f
for id in $(printf '%s' "$pages" | tr ',' ' '); do
	curl -fsS --max-time 120 -u "$email:$${TOKEN}" -H "Accept: application/json" "https://$site/wiki/api/v2/pages/$id?body-format=storage" > "$dest/$id.json.part"
	jq -r '${PAGE_MARKDOWN}' "$dest/$id.json.part" > "$dest/$id.md"
	rm -f "$dest/$id.json.part"
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
