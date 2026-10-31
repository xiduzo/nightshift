/**
 * Shell text the knowledge kits share. Each command holds its own copy, so
 * a kit copied into a project reads on its own.
 */
import type { FlowInput } from "../../flow";

/**
 * Night Shift's own folders in the knowledge: no source fills them.
 * `learnings/` holds what agents propose and what a person kept, `evals/`
 * the question set. The kits and the Knowledge page's sources refuse them.
 */
const KNOWLEDGE_OWN_FOLDERS: readonly string[] = ["learnings", "evals"];

/** Whether a folder of the knowledge is one of Night Shift's own, or in one. */
export function isKnowledgeOwnFolder(folder: string): boolean {
	return KNOWLEDGE_OWN_FOLDERS.some(
		(name) => folder === name || folder.startsWith(`${name}/`),
	);
}

/** That a folder is Night Shift's own, as the kits and the sources say it. */
export const KNOWLEDGE_OWN_FOLDERS_WORDS = `${KNOWLEDGE_OWN_FOLDERS.join(" and ")} are Night Shift's own.`;

/**
 * The start of every sync command: it stops on the first error, finds
 * the project's knowledge folder in `$NS_KNOWLEDGE`, and sets `dest` to
 * the kit's folder in it. It refuses Night Shift's own folders.
 */
export const KNOWLEDGE_DEST = String.raw`set -e
if [ -z "$NS_KNOWLEDGE" ]; then echo "Run this kit in a flow: the step gets the project's knowledge folder there." >&2; exit 2; fi
folder="{{folder}}"
case "$folder" in
	""|/*|..|../*|*/..|*/../*|${KNOWLEDGE_OWN_FOLDERS.flatMap((name) => [name, `${name}/*`]).join("|")}) echo "Choose a folder inside the knowledge folder, for example docs. ${KNOWLEDGE_OWN_FOLDERS_WORDS}" >&2; exit 2 ;;
esac
dest="$NS_KNOWLEDGE/$folder"`;

/** The end of every sync command: how many files the kit's folder has, as its data. */
export const COUNT_FILES = String.raw`files=$(find "$dest" -type f -not -path '*/.git/*' | wc -l | tr -d ' ')
printf '{"files": %s}' "$files" > "$NS_OUTPUT"`;

/** The input every knowledge kit has: its folder in the knowledge folder. */
export function folderInput(
	name: string,
): NonNullable<FlowInput["inputs"]>[number] {
	return {
		name: "folder",
		label: "Folder in the knowledge",
		type: "text",
		description: `The folder in the project's knowledge that this sync fills, for example ${name}. Give each sync its own folder.`,
		default: name,
	};
}

/** The ends every knowledge kit has: synced, or not. */
export function syncEnds(
	what: string,
): Pick<FlowInput, "nodes" | "edges" | "outputs"> {
	return {
		outputs: [
			{
				name: "files",
				value: "{{sync.data.files}}",
				description: "How many files the folder has now.",
			},
		],
		nodes: [
			{
				id: "synced",
				type: "end",
				position: { x: 300, y: -60 },
				status: "done",
				message: `${what}: {{sync.data.files}} files`,
			},
			{
				id: "not_synced",
				type: "end",
				position: { x: 300, y: 60 },
				status: "failed",
				message: `Could not sync ${what.toLowerCase()}`,
			},
		],
		edges: [
			{ id: "sync-synced", from: "sync", outcome: "synced", to: "synced" },
			{ id: "sync-fail", from: "sync", outcome: "fail", to: "not_synced" },
		],
	};
}
