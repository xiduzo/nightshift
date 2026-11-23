import type { CliTool, CliToolEntry } from "../domain/cli-tool";

/**
 * The CLI tools in this computer's Device document. A read is synchronous:
 * the start check of a run reads the names.
 */
export type SavedCliTools = {
	/** The tools that parse, by name. An entry this version cannot read is left out. */
	read(): ReadonlyMap<string, CliTool>;
	/** Adds or replaces the tool of `name`, in one change of the document. */
	write(name: string, entry: CliToolEntry): Promise<void>;
	/** Removes the tool of `name`, in one change of the document. */
	remove(name: string): Promise<void>;
};

/**
 * A program's own help (`--help`) on this computer.
 * @filledBy agents
 */
export type ProgramHelp = {
	/** The help, or null when the program has none. */
	help(program: string): Promise<string | null>;
};
