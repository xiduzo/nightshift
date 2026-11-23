import { cliHelp } from "@nightshift/agents/tools";
import { now as timeNow } from "@nightshift/time";
import { NIGHT_SHIFT } from "../../contract";
import type { DeviceDocument } from "../../documents";
import { yjsSavedCliTools } from "./adapters/out/yjs-saved-cli-tools";
import { readCliToolGuides } from "./application/read-cli-tool-guides";
import { saveCliTool } from "./application/save-cli-tool";
import { type CliTool, type CliToolInput, programOf } from "./domain/cli-tool";
import type { CliToolGuide } from "./domain/cli-tool-guides";

/** This computer's CLI tools, as their readers and the edits use them. */
export type CliToolStore = {
	/** Reads the CLI tools. Call once before `names`. */
	load(): Promise<void>;
	/** The CLI tool names, for the start check. */
	names(): ReadonlySet<string>;
	list(): CliTool[];
	get(name: string): CliTool | null;
	/** The program a tool of that name runs. A name no tool has is a program. */
	program(name: string): string;
	/**
	 * What an agent learns about the tools of these names when its session
	 * starts: each description, and the program's own help.
	 */
	guides(names: readonly string[]): Promise<CliToolGuide[]>;
	/** Creates or replaces a CLI tool. */
	save(input: CliToolInput): Promise<CliTool>;
	remove(name: string): Promise<void>;
};

/** The CLI tools, and the use case of a person's door. */
export type CliTools = CliToolStore & {
	saveCliTool: ReturnType<typeof saveCliTool>;
};

/**
 * The CLI tools of this computer over its Device document. It binds the
 * use cases `saveCliTool` and `readCliToolGuides` behind the store that
 * the readers and the edits use today. The store acts as Night Shift: the
 * doors check the owner of this computer first.
 */
export function wireCliTools(deps: {
	document: DeviceDocument;
	/** A program's own help (`--help`), or null. Default: `cliHelp`. */
	help?: (program: string) => Promise<string | null>;
}): CliTools {
	const saved = yjsSavedCliTools(deps.document);
	const help = deps.help ?? ((program: string) => cliHelp(program));
	const save = saveCliTool({ saved, now: timeNow });
	const guides = readCliToolGuides({ saved, programs: { help } });
	return {
		// The document is read when it opens; a remote edit applies at once.
		async load() {},
		names: () => new Set(saved.read().keys()),
		list: () =>
			[...saved.read().values()].sort((a, b) => a.name.localeCompare(b.name)),
		get: (name) => saved.read().get(name) ?? null,
		program: (name) =>
			programOf(saved.read().get(name) ?? { name, program: null }),
		guides: (names) => guides({ names }),
		save: (input) => save(NIGHT_SHIFT, input),
		remove: (name) => saved.remove(name),
		saveCliTool: save,
	};
}
