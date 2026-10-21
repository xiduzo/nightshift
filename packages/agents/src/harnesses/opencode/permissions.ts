/**
 * OpenCode's permission rules for each permission mode, and the mode of
 * the adapter's own permission handler. See "Permissions" in `harness.ts`.
 */
import type { PermissionMode } from "../../port";

type Action = "allow" | "deny";
/** One permission: an action, or an action per pattern (`bash`: per command). */
type Rule = Action | Record<string, Action>;

/** OpenCode's built-in permissions (1.x). Each one is set, so none falls back to `ask`. */
const PERMISSIONS = [
	"read",
	"edit",
	"glob",
	"grep",
	"list",
	"bash",
	"task",
	"external_directory",
	"todowrite",
	"todoread",
	"question",
	"webfetch",
	"websearch",
	"codesearch",
	"lsp",
	"doom_loop",
	"skill",
] as const;

/** Permissions that only read the worktree or the agent's own state. */
const READ_ONLY = new Set([
	"read",
	"glob",
	"grep",
	"list",
	"lsp",
	"todowrite",
	"todoread",
	"skill",
]);

/**
 * OpenCode permission rules for a permission mode. OpenCode applies the last
 * matching rule, so `*` comes first. Nothing resolves to `ask`:
 *
 * - `bypassPermissions`: allow everything.
 * - `auto`: allow reading, editing, commands, the web and subagents; deny
 *   paths outside the worktree (`external_directory`) and repeated identical
 *   calls (`doom_loop`), which a person would otherwise be asked about.
 * - `acceptEdits`: `auto` without commands and the web (`bash`, `webfetch`,
 *   `websearch`, `codesearch` denied), like Claude Code, where those would
 *   ask and nobody answers.
 * - `default` and `plan`: read-only. Only the read permissions are allowed;
 *   edits, commands, the web and subagents are denied.
 *
 * Every mode denies `question` (no person to answer) and allows the bridged
 * tools (`tanstack_*`: `report_step`) and the tools of the session's own MCP
 * servers (`<server>_*`): the node listed them on purpose. Its CLI tools
 * (`clis`) are allowed in the shell when the mode denies other commands
 * (`acceptEdits`, `default`); plan mode runs nothing.
 */
export function opencodePermission(
	mode: PermissionMode,
	mcpServerNames: readonly string[] = [],
	clis: readonly string[] = [],
): Record<string, Rule> {
	const set = (pick: (name: string) => Action): Record<string, Action> =>
		Object.fromEntries(PERMISSIONS.map((name) => [name, pick(name)]));
	let rules: Record<string, Action>;
	switch (mode) {
		case "bypassPermissions":
			rules = { "*": "allow", ...set(() => "allow") };
			break;
		case "auto":
			rules = {
				"*": "allow",
				...set((name) =>
					name === "external_directory" || name === "doom_loop"
						? "deny"
						: "allow",
				),
			};
			break;
		case "acceptEdits":
			rules = {
				"*": "allow",
				...set((name) =>
					[
						"bash",
						"webfetch",
						"websearch",
						"codesearch",
						"external_directory",
						"doom_loop",
					].includes(name)
						? "deny"
						: "allow",
				),
			};
			break;
		default:
			rules = {
				"*": "deny",
				...set((name) => (READ_ONLY.has(name) ? "allow" : "deny")),
			};
	}
	rules.question = "deny";
	rules["tanstack_*"] = "allow";
	for (const name of mcpServerNames) rules[`${name}_*`] = "allow";
	if (rules.bash === "allow" || mode === "plan" || clis.length === 0) {
		return rules;
	}
	const bash: Record<string, Action> = { "*": "deny" };
	for (const name of clis) {
		bash[name] = "allow";
		bash[`${name} *`] = "allow";
	}
	return { ...rules, bash };
}

/** The adapter's own permission handler mode, for requests it does see. */
export function adapterPermissionMode(
	mode: PermissionMode,
): "default" | "acceptEdits" | "bypassPermissions" {
	if (mode === "auto" || mode === "bypassPermissions") {
		return "bypassPermissions";
	}
	return mode === "acceptEdits" ? "acceptEdits" : "default";
}
