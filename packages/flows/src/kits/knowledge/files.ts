import type { FlowInput } from "../../flow";
import { COUNT_FILES, folderInput, KNOWLEDGE_DEST, syncEnds } from "./shell";

/**
 * `kit:knowledge/files`: copies files of the project's own folder into its
 * knowledge. The run's copy of the project has only what git tracks, so
 * the paths are read in the project's folder itself: files git ignores,
 * such as `docs/private/`, become knowledge without a commit.
 */
export const knowledgeFilesKit: FlowInput = {
	version: 7,
	description:
		"Copies files of the project into its knowledge, also files that git ignores, such as private notes. It replaces what the folder had.",
	inputs: [
		{
			name: "from",
			label: "What to copy",
			type: "text",
			description:
				"What to copy, one path or pattern per line, in the project's folder: docs/private or notes/*.md.",
			required: true,
		},
		folderInput("files"),
	],
	start: "sync",
	...withSync(),
};

function withSync(): Pick<FlowInput, "nodes" | "edges" | "outputs"> {
	const ends = syncEnds("Files copied");
	return {
		outputs: ends.outputs,
		nodes: [
			{
				id: "sync",
				type: "command",
				label: "Copy the files",
				position: { x: 0, y: 0 },
				command: String.raw`${KNOWLEDGE_DEST}
# The project's own folder: the run works in a copy that has only what git tracks.
common=$(git rev-parse --git-common-dir)
case "$common" in /*) ;; *) common="$PWD/$common" ;; esac
project=$(cd "$common/.." && pwd)
from="{{from}}"
part="$dest.part"
rm -rf "$part"
mkdir -p "$part"
cd "$project"
found=0
IFS='
'
for src in $from; do
	[ -e "$src" ] || continue
	rel=$(printf '%s' "$src" | sed 's#^/*##')
	mkdir -p "$part/$(dirname "$rel")"
	cp -R "$src" "$part/$rel"
	found=$((found + 1))
done
if [ "$found" -eq 0 ]; then
	rm -rf "$part"
	echo "Nothing in the project's folder matches: $from" >&2
	exit 3
fi
rm -rf "$dest"
mv "$part" "$dest"
${COUNT_FILES}`,
				exits: [
					{ name: "synced", code: 0, color: "green" },
					{ name: "nothing", code: 3, color: "orange" },
					{ name: "fail", color: "red" },
				],
			},
			...(ends.nodes ?? []),
			{
				id: "nothing_found",
				type: "end",
				position: { x: 300, y: 180 },
				status: "failed",
				message: "No files match {{from}}",
			},
		],
		edges: [
			...(ends.edges ?? []),
			{
				id: "sync-nothing",
				from: "sync",
				outcome: "nothing",
				to: "nothing_found",
			},
		],
	};
}
