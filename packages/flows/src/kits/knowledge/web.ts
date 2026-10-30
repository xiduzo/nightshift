import type { FlowInput } from "../../flow";
import { COUNT_FILES, folderInput, KNOWLEDGE_DEST, syncEnds } from "./shell";

/**
 * `kit:knowledge/web`: web pages as markdown in the project's knowledge,
 * through the free reader at r.jina.ai, with `curl`. No account.
 */
export const knowledgeWebKit: FlowInput = {
	version: 7,
	description:
		"Copies web pages into the project's knowledge as markdown. It needs no account. Each page gets a file named after its address.",
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
	const ends = syncEnds("Pages synced");
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
for url in $urls; do
	name=$(printf '%s' "$url" | sed -e 's#^[A-Za-z]*://##' -e 's#[/?=&:]#-#g' -e 's#[^A-Za-z0-9._-]##g' -e 's#-*$##')
	curl -fsSL --max-time 120 "https://r.jina.ai/$url" > "$dest/$name.md.part"
	mv "$dest/$name.md.part" "$dest/$name.md"
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
