/**
 * What the assistant does now, in plain words: "Reads package.json". The
 * person sees these lines while they wait, so they never show a raw tool
 * name. Each harness names its tools its own way (`Read`, `read`,
 * `mcp__tanstack__report_step`, `tanstack_report_step`); this reads them all.
 */
import { isAbsolute, relative } from "node:path";

/** The tool's own name: without an MCP server prefix (`mcp__x__`, `tanstack_`). */
export function bareToolName(name: string): string {
	const mcp = /^mcp__.+?__(.+)$/.exec(name);
	const bare = mcp?.[1] ?? name.replace(/^tanstack_/, "");
	return bare.toLowerCase();
}

function field(input: unknown, keys: readonly string[]): string | undefined {
	if (typeof input !== "object" || input === null) return undefined;
	for (const key of keys) {
		const value = (input as Record<string, unknown>)[key];
		if (typeof value === "string" && value.trim() !== "") return value.trim();
	}
	return undefined;
}

/** A path as the person knows it: relative to the project's folder. */
function shown(path: string, cwd: string): string {
	if (!isAbsolute(path)) return path.replace(/^\.\//, "");
	const inside = relative(cwd, path);
	return inside === ""
		? "the project folder"
		: inside.startsWith("..")
			? path
			: inside;
}

function short(text: string, max = 48): string {
	const line = text.replace(/\s+/g, " ");
	return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

const READS = new Set(["read", "read_file", "view", "readfile", "open"]);
const SEARCHES = new Set([
	"grep",
	"search",
	"rg",
	"codesearch",
	"search_files",
]);
const FINDS = new Set(["glob", "find", "find_files", "file_search"]);
const LISTS = new Set(["ls", "list", "list_directory", "list_dir"]);
const WEB = new Set(["webfetch", "websearch", "web_fetch", "web_search"]);
const QUIET = new Set([
	"todowrite",
	"todoread",
	"todo_write",
	"skill",
	"toolsearch",
]);

/**
 * The line for one tool call, or null for a call the person need not see
 * (the agent's own to-do list). `describe` names Night Shift's own tools
 * first; a tool nobody knows becomes "Looks through the project".
 */
export function activityOf(
	name: string,
	input: unknown,
	cwd: string,
	describe?: (name: string, input: unknown) => string | undefined,
): string | null {
	const tool = bareToolName(name);
	const own = describe?.(tool, input);
	if (own) return own;
	if (QUIET.has(tool)) return null;
	const path = field(input, [
		"file_path",
		"filePath",
		"path",
		"file",
		"target_file",
		"absolute_path",
	]);
	if (READS.has(tool)) {
		return path ? `Reads ${shown(path, cwd)}` : "Reads a file";
	}
	if (SEARCHES.has(tool)) {
		const pattern = field(input, ["pattern", "query", "regex"]);
		return pattern
			? `Searches for "${short(pattern)}"`
			: "Searches the project";
	}
	if (FINDS.has(tool)) {
		const pattern = field(input, ["pattern", "glob", "query", "name"]);
		return pattern
			? `Looks for files like ${short(pattern)}`
			: "Looks for files";
	}
	if (LISTS.has(tool)) {
		return `Lists ${path ? shown(path, cwd) : "the project folder"}`;
	}
	if (WEB.has(tool)) return "Looks something up on the web";
	if (tool === "report_step") return "Writes the answer";
	return "Looks through the project";
}
