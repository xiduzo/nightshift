import type { FlowInput } from "../../flow";
import { KNOWLEDGE_STAGING_SUFFIX } from "./layout";
import { FIND_FILES, folderInput, KNOWLEDGE_DEST, syncEnds } from "./shell";

/**
 * `kit:knowledge/web`: web pages as markdown in the project's knowledge,
 * through the free reader at r.jina.ai, with `curl`. No account. A page
 * that cannot be read keeps its last copy and does not stop the others: the
 * sync fails only when it reads no page at all. The reader answers 200 for a
 * page that is gone or behind a bot check, and says so in a `Warning:` line
 * above the content.
 */
export const knowledgeWebKit: FlowInput = {
	version: 8,
	description:
		"Copies web pages into the project's knowledge as markdown. It needs no account. Each page gets a file named after its address. A page that cannot be read does not stop the others.",
	inputs: [
		{
			name: "urls",
			label: "Pages",
			type: "text",
			description:
				"The pages, one address per line, for example https://example.com/docs.",
			required: true,
		},
		folderInput("web"),
	],
	start: "sync",
	...withSync(),
};

function withSync(): Pick<FlowInput, "nodes" | "edges" | "outputs"> {
	const ends = syncEnds(
		"Pages synced",
		"Could not read any page. {{sync.log_tail}}",
		"{{sync.data.skipped}}",
	);
	return {
		...ends,
		nodes: [
			{
				id: "sync",
				type: "command",
				label: "Read the pages",
				position: { x: 0, y: 0 },
				command: String.raw`${KNOWLEDGE_DEST}
urls="{{urls}}"
mkdir -p "$dest"
# Split the list, but never read a pattern in it.
set -f
kept=0
missed=""
for url in $urls; do
	name=$(printf '%s' "$url" | sed -e 's#^[A-Za-z]*://##' -e 's#[/?=&:]#-#g' -e 's#[^A-Za-z0-9._-]##g' -e 's#-*$##')
	part="$dest/$name.md${KNOWLEDGE_STAGING_SUFFIX}"
	if ! curl -fsL --max-time 120 "https://r.jina.ai/$url" > "$part"; then
		echo "Could not read $url: the page did not load." >&2
	elif sed -n '1,/^Markdown Content:/p' "$part" | grep -q -E '^Warning: (Target URL returned error|This page maybe requiring CAPTCHA)'; then
		echo "Could not read $url: the page is gone or blocks readers." >&2
	else
		mv "$part" "$dest/$name.md"
		kept=$((kept + 1))
		continue
	fi
	rm -f "$part"
	missed="$missed $url"
done
if [ "$kept" -eq 0 ]; then exit 1; fi
skipped=""
if [ -n "$missed" ]; then
	skipped=$(printf '. Could not read:%s' "$missed" | sed -e 's/[\\"]/\\&/g')
fi
${FIND_FILES}
printf '{"files": %s, "skipped": "%s"}' "$files" "$skipped" > "$NS_OUTPUT"`,
				exits: [
					{ name: "synced", code: 0, color: "green" },
					{ name: "fail", color: "red" },
				],
			},
			...(ends.nodes ?? []),
		],
	};
}
