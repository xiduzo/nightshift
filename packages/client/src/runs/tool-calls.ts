/**
 * An agent's tool calls, read the same way on the web and on the phone: what
 * kind of work a call does, a run of calls folded into one group, and that
 * group in words ("Ran 6 commands · read 3 files").
 */

/**
 * What a tool call does, from its tool's name:
 * - `command`: runs a shell command (Bash, shell, exec).
 * - `read`: reads a file.
 * - `edit`: writes or changes a file (Edit, Write, MultiEdit, apply_patch).
 * - `search`: searches files or folders (Grep, Glob, find, ls).
 * - `web`: reads or searches the web.
 * - `other`: any other tool.
 */
export type ToolKind = "command" | "read" | "edit" | "search" | "web" | "other";

/**
 * The kind of a tool call. The names cover Claude Code (`Bash`, `Read`,
 * `Edit`), Codex (`shell`, `exec_command`, `apply_patch`), OpenCode and pi
 * (`bash`, `read`, `write`, `grep`, `ls`), in any case.
 */
export function toolKind(name: string): ToolKind {
	const lower = name.toLowerCase();
	// A todo list is the agent's plan, not a file it writes.
	if (lower.includes("todo")) return "other";
	if (lower.includes("web") || lower.includes("fetch") || lower === "url")
		return "web";
	if (
		lower === "bash" ||
		lower.includes("shell") ||
		lower.includes("exec") ||
		lower.includes("command") ||
		lower.includes("terminal")
	)
		return "command";
	if (
		lower.includes("edit") ||
		lower.includes("write") ||
		lower.includes("patch") ||
		lower.includes("str_replace") ||
		lower === "create_file"
	)
		return "edit";
	if (
		lower === "read" ||
		lower === "read_file" ||
		lower === "view" ||
		lower === "cat"
	)
		return "read";
	if (
		lower.includes("grep") ||
		lower.includes("glob") ||
		lower === "search" ||
		lower === "codebase_search" ||
		lower === "find" ||
		lower === "ls" ||
		lower === "list" ||
		lower === "list_dir"
	)
		return "search";
	return "other";
}

/** How each kind reads in a summary, by count, in the order a summary lists them. */
const KIND_WORDS: readonly [ToolKind, (count: number) => string][] = [
	["command", (n) => `ran ${n} ${n === 1 ? "command" : "commands"}`],
	["read", (n) => `read ${n} ${n === 1 ? "file" : "files"}`],
	["edit", (n) => `edited ${n} ${n === 1 ? "file" : "files"}`],
	["search", (n) => (n === 1 ? "searched once" : `searched ${n} times`)],
	["web", (n) => `opened ${n} web ${n === 1 ? "page" : "pages"}`],
	["other", (n) => `used ${n} ${n === 1 ? "tool" : "tools"}`],
];

/**
 * A run of tool calls in words, by the tool names of its calls: "Ran 6
 * commands · read 3 files · edited 2 files". Kinds keep a fixed order, so
 * the line does not jump while calls arrive. Empty for no calls.
 */
export function toolCallsSummary(names: readonly string[]): string {
	const counts = new Map<ToolKind, number>();
	for (const name of names) {
		const kind = toolKind(name);
		counts.set(kind, (counts.get(kind) ?? 0) + 1);
	}
	const parts = KIND_WORDS.flatMap(([kind, words]) => {
		const count = counts.get(kind);
		return count ? [words(count)] : [];
	});
	const text = parts.join(" · ");
	return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A part of a transcript: one item as it is, or two or more tool calls in a row. */
export type TranscriptRow<T> =
	| { kind: "item"; item: T }
	| { kind: "tool-calls"; items: T[] };

/**
 * Folds each run of two or more tool calls in a row into one group. Any
 * other item ends a run. A single tool call stays a row of its own.
 */
export function groupToolCalls<T>(
	items: readonly T[],
	isToolCall: (item: T) => boolean,
): TranscriptRow<T>[] {
	const rows: TranscriptRow<T>[] = [];
	let run: T[] = [];
	const flush = () => {
		if (run.length === 1 && run[0] !== undefined) {
			rows.push({ kind: "item", item: run[0] });
		} else if (run.length > 1) {
			rows.push({ kind: "tool-calls", items: run });
		}
		run = [];
	};
	for (const item of items) {
		if (isToolCall(item)) {
			run.push(item);
		} else {
			flush();
			rows.push({ kind: "item", item });
		}
	}
	flush();
	return rows;
}
