import type { FlowInput } from "../../flow";
import { COUNT_FILES, folderInput, KNOWLEDGE_DEST, syncEnds } from "./shell";

/** The most files one sync of a folder copies: more is rarely knowledge. */
export const FOLDER_MAX_FILES = 5000;

/**
 * `kit:knowledge/folder`: copies a folder anywhere on the computer into
 * the project's knowledge, such as notes or specs that live outside any
 * repository. A folder exists on one computer only: run the sync there.
 * Hidden files and folders stay out. It replaces what the folder had.
 */
export const knowledgeFolderKit: FlowInput = {
	version: 7,
	description:
		"Copies a folder of this computer into the project's knowledge, such as notes outside the project. It replaces what the folder had.",
	inputs: [
		{
			name: "path",
			label: "Folder",
			type: "text",
			description:
				"The full path of the folder, for example ~/notes or /Users/you/specs.",
			required: true,
		},
		{
			name: "patterns",
			label: "Files",
			type: "text",
			description:
				"Which files to copy, one pattern per line, for example *.md. Empty copies every file.",
		},
		folderInput("folder"),
	],
	start: "sync",
	...withSync(),
};

function withSync(): Pick<FlowInput, "nodes" | "edges" | "outputs"> {
	const ends = syncEnds("Folder copied");
	return {
		outputs: ends.outputs,
		nodes: [
			{
				id: "sync",
				type: "command",
				label: "Copy the folder",
				position: { x: 0, y: 0 },
				command: String.raw`${KNOWLEDGE_DEST}
src="{{path}}"
case "$src" in
	"~") src="$HOME" ;;
	"~/"*) src="$HOME/$(printf '%s' "$src" | cut -c3-)" ;;
esac
case "$src" in
	/*) ;;
	*) echo "Enter the full path of the folder, for example ~/notes." >&2; exit 2 ;;
esac
if [ ! -d "$src" ]; then
	echo "This computer has no folder $src." >&2
	exit 3
fi
patterns="{{patterns}}"
part="$dest.part"
list=$(mktemp)
trap 'rm -rf "$part" "$list"' EXIT
rm -rf "$part"
mkdir -p "$part"
cd "$src"
# Split the patterns, but never expand one here: find matches them.
set -f
if [ -z "$patterns" ]; then
	find . -type f -not -path '*/.*' | sed 's#^\./##' > "$list"
else
	for pattern in $patterns; do
		pattern=$(printf '%s' "$pattern" | sed 's#^\./##')
		find . -type f -not -path '*/.*' \( -path "./$pattern" -o -path "./$pattern/*" \) | sed 's#^\./##' >> "$list"
	done
fi
sort -u -o "$list" "$list"
count=$(wc -l < "$list" | tr -d ' ')
if [ "$count" -eq 0 ]; then
	echo "No files in $src match: $patterns" >&2
	exit 3
fi
if [ "$count" -gt ${FOLDER_MAX_FILES} ]; then
	echo "$src has $count files. Copy at most ${FOLDER_MAX_FILES}: choose a smaller folder, or patterns." >&2
	exit 4
fi
while IFS= read -r rel; do
	mkdir -p "$part/$(dirname "$rel")"
	cp -p "$rel" "$part/$rel"
done < "$list"
rm -rf "$dest"
mv "$part" "$dest"
${COUNT_FILES}`,
				exits: [
					{ name: "synced", code: 0, color: "green" },
					{ name: "nothing", code: 3, color: "orange" },
					{ name: "too-many", code: 4, color: "orange" },
					{ name: "fail", color: "red" },
				],
			},
			...(ends.nodes ?? []),
			{
				id: "nothing_found",
				type: "end",
				position: { x: 300, y: 180 },
				status: "failed",
				message: "No files to copy in {{path}}",
			},
			{
				id: "too_many_files",
				type: "end",
				position: { x: 300, y: 300 },
				status: "failed",
				message: `{{path}} has more than ${FOLDER_MAX_FILES} files`,
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
			{
				id: "sync-too-many",
				from: "sync",
				outcome: "too-many",
				to: "too_many_files",
			},
		],
	};
}
