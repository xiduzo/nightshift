import type { FlowInput } from "../../flow";
import { KNOWLEDGE_OWN_FOLDERS, KNOWLEDGE_OWN_FOLDERS_WORDS } from "./layout";

/**
 * The module behind every Knowledge source: one declaration goes in, and
 * the kit and its kind come out, so they cannot drift. The interface is
 * `defineSyncKit`. Its implementation holds what every sync does the same:
 * find its folder, check its programs, count its files, end as synced or
 * not. Each command holds its own copy of this shell, so a kit copied into
 * a project reads on its own.
 */

/**
 * The input every sync kit has: its folder in the knowledge. Night Shift
 * picks it for a source, so the page does not ask for it.
 */
export const KNOWLEDGE_FOLDER_INPUT = "folder";

/**
 * The start of every sync command: it stops on the first error, finds
 * the project's knowledge folder in `$NS_KNOWLEDGE`, and sets `dest` to
 * the kit's folder in it. It refuses Night Shift's own folders.
 */
const KNOWLEDGE_DEST = String.raw`set -e
if [ -z "$NS_KNOWLEDGE" ]; then echo "Run this kit in a flow: the step gets the project's knowledge folder there." >&2; exit 2; fi
folder="{{folder}}"
case "$folder" in
	""|/*|..|../*|*/..|*/../*|${KNOWLEDGE_OWN_FOLDERS.flatMap((name) => [name, `${name}/*`]).join("|")}) echo "Choose a folder inside the knowledge folder, for example docs. ${KNOWLEDGE_OWN_FOLDERS_WORDS}" >&2; exit 2 ;;
esac
dest="$NS_KNOWLEDGE/$folder"`;

/** One input of a kit, as a person fills it in. */
type KitInput = NonNullable<FlowInput["inputs"]>[number];

/**
 * A program a source's script runs, besides a POSIX shell and git. The
 * project readiness check names it when it is missing. `why` makes the
 * script itself stop first and say what to install. Without it, the
 * program's own error stops the script.
 */
type SourceProgram = { name: string; why?: string };

/**
 * A way the script stops short of a sync: it exits with `code`, and the
 * flow ends as failed at the end node `end`, with `message`.
 */
type SyncStop = {
	outcome: string;
	code: number;
	end: string;
	message: string;
};

/** One Knowledge source, whole. `main` and `lines` can name only its inputs. */
type SyncSource<Name extends string, Input extends string> = {
	/** The kit's name after `kit:knowledge/`. */
	name: Name;
	/** What it fills the knowledge from, for a person: "Web pages". */
	label: string;
	/** What it is, in one line, where a person chooses a source. */
	blurb: string;
	/** The name of its first flow: a second gets `-2`. */
	flowName: string;
	/** The input that tells two sources of this kind apart: its value describes the source. */
	main: NoInfer<Input>;
	/** The inputs that take one value per line. */
	lines: readonly NoInfer<Input>[];
	/** It reads a folder of one computer: its runs belong on that Device. */
	local?: true;
	/** It reads the project's own folder: a project without one (ADR 22) cannot use it. */
	needsFolder?: true;
	/** What its script runs. A CLI tool the person picks (`acli`) has its own check. */
	programs: readonly SourceProgram[];
	/** The kit's description. */
	description: string;
	/** What a person fills in. The folder comes on its own. */
	inputs: readonly (KitInput & { name: Input })[];
	/** The folder in the knowledge it fills unless the source says another. */
	folder: string;
	/** The label of the step that syncs. */
	stepLabel: string;
	/** The secrets the script reads. */
	secrets?: readonly string[];
	/** The shell between finding `dest` and counting its files. */
	script: string;
	/** More strings for the step's data, by name, each from a shell value: `"$skipped"`. */
	data?: Readonly<Record<string, string>>;
	messages: {
		/** Starts the message of a sync, before its file count. */
		synced: string;
		/** A template that follows the file count. */
		syncedMore?: string;
		/** The message of a sync that failed. */
		notSynced: string;
	};
	stops?: readonly SyncStop[];
};

/** One kind of source, as the page shows it and a new flow is named. */
export type SourceKind<Kit extends string> = {
	kit: Kit;
	label: string;
	blurb: string;
	flowName: string;
	main: string;
	lines: readonly string[];
	local: boolean;
	/** It reads the project's own folder: not offered for a project without one. */
	needsFolder: boolean;
	/** The programs to name when they are missing. */
	programs: readonly string[];
};

/** What a declaration yields: the kit under its name, and its kind. */
type SyncKit<Name extends string> = {
	kit: `kit:knowledge/${Name}`;
	flow: FlowInput;
	kind: SourceKind<`kit:knowledge/${Name}`>;
};

/** The end of a sync command: how many files the folder has, as its data. */
function reportFiles(data: Readonly<Record<string, string>>): string {
	const names = Object.keys(data);
	const format = names.map((name) => `, "${name}": "%s"`).join("");
	const values = names.map((name) => ` "${data[name]}"`).join("");
	return String.raw`files=$(find "$dest" -type f -not -path '*/.git/*' | wc -l | tr -d ' ')
printf '{"files": %s${format}}' "$files"${values} > "$NS_OUTPUT"`;
}

/** The line that stops a script when this computer has no `name`. */
function programCheck({ name, why }: SourceProgram): string[] {
	if (why === undefined) return [];
	return [
		`if ! command -v ${name} >/dev/null; then echo "Install ${name}: ${why}." >&2; exit 2; fi`,
	];
}

/** Yields the kit of a source and its kind, from its one declaration. */
export function defineSyncKit<
	const Name extends string,
	const Input extends string,
>(source: SyncSource<Name, Input>): SyncKit<Name> {
	const kit = `kit:knowledge/${source.name}` as const;
	const stops = source.stops ?? [];
	const { synced, syncedMore = "", notSynced } = source.messages;
	return {
		kit,
		kind: {
			kit,
			label: source.label,
			blurb: source.blurb,
			flowName: source.flowName,
			main: source.main,
			lines: source.lines,
			local: source.local ?? false,
			needsFolder: source.needsFolder ?? false,
			programs: source.programs.map((program) => program.name),
		},
		flow: {
			version: 9,
			description: source.description,
			inputs: [
				...source.inputs,
				{
					name: KNOWLEDGE_FOLDER_INPUT,
					label: "Folder in the knowledge",
					type: "text",
					description: `The folder in the project's knowledge that this sync fills, for example ${source.folder}. Give each sync its own folder.`,
					default: source.folder,
				},
			],
			start: "sync",
			outputs: [
				{
					name: "files",
					value: "{{sync.data.files}}",
					description: "How many files the folder has now.",
				},
			],
			nodes: [
				{
					id: "sync",
					type: "command",
					label: source.stepLabel,
					position: { x: 0, y: 0 },
					...(source.secrets ? { secrets: [...source.secrets] } : {}),
					command: [
						KNOWLEDGE_DEST,
						...source.programs.flatMap(programCheck),
						source.script,
						reportFiles(source.data ?? {}),
					].join("\n"),
					exits: [
						{ name: "synced", code: 0, color: "green" },
						...stops.map((stop) => ({
							name: stop.outcome,
							code: stop.code,
							color: "orange" as const,
						})),
						{ name: "fail", color: "red" },
					],
				},
				{
					id: "synced",
					type: "end",
					position: { x: 300, y: -60 },
					status: "done",
					message: `${synced}: {{sync.data.files}} files${syncedMore}`,
				},
				{
					id: "not_synced",
					type: "end",
					position: { x: 300, y: 60 },
					status: "failed",
					message: notSynced,
				},
				...stops.map((stop, index) => ({
					id: stop.end,
					type: "end" as const,
					position: { x: 300, y: 180 + index * 120 },
					status: "failed" as const,
					message: stop.message,
				})),
			],
			edges: [
				{ id: "sync-synced", from: "sync", outcome: "synced", to: "synced" },
				{ id: "sync-fail", from: "sync", outcome: "fail", to: "not_synced" },
				...stops.map((stop) => ({
					id: `sync-${stop.outcome}`,
					from: "sync",
					outcome: stop.outcome,
					to: stop.end,
				})),
			],
		},
	};
}
