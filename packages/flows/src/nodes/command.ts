import { z } from "zod";
import {
	labelSchema,
	type NodeCheck,
	nodeBase,
	placed,
	secretNameSchema,
} from "./common";
import { checkOptions, outcomeColorSchema } from "./outcomes";

/** The Command node: a shell command whose exit code picks the outcome. */

/**
 * One exit of a Command node: an exit code and the outcome it ends with.
 * The exit without a `code` is the catch-all: any other code, a command
 * that cannot start, and JSON output that is not valid. At most one, last.
 */
export const commandExitSchema = z.object({
	name: labelSchema,
	code: z.number().int().min(0).max(255).optional(),
	description: z.string().optional(),
	color: outcomeColorSchema.optional(),
});
export type CommandExit = z.infer<typeof commandExitSchema>;

/** The exits of a Command node that does not list its own: today's pass and fail. */
export const LEGACY_COMMAND_EXITS: CommandExit[] = [
	{ name: "pass", code: 0 },
	{ name: "fail" },
];

/** The exits a new Command node starts with. */
export const DEFAULT_COMMAND_EXITS: CommandExit[] = [
	{
		name: "success",
		code: 0,
		description: "The command succeeded.",
		color: "green",
	},
	{ name: "failure", code: 1, description: "General error.", color: "red" },
	{ name: "other", description: "Any other exit code.", color: "gray" },
];

/**
 * Common exit codes on Linux and macOS, offered when adding an exit.
 * 128 + n is "killed by signal n".
 */
export const STANDARD_EXIT_CODES: CommandExit[] = [
	{
		name: "success",
		code: 0,
		description: "The command succeeded.",
		color: "green",
	},
	{ name: "failure", code: 1, description: "General error.", color: "red" },
	{
		name: "misuse",
		code: 2,
		description: "Wrong use of a shell builtin or wrong arguments.",
		color: "orange",
	},
	{
		name: "cannot-execute",
		code: 126,
		description: "The command was found but cannot run.",
		color: "red",
	},
	{
		name: "not-found",
		code: 127,
		description: "The command was not found.",
		color: "red",
	},
	{
		name: "cancelled",
		code: 130,
		description: "Stopped with Ctrl+C (SIGINT).",
		color: "amber",
	},
	{
		name: "killed",
		code: 137,
		description: "Killed (SIGKILL), often out of memory.",
		color: "red",
	},
	{
		name: "terminated",
		code: 143,
		description: "Terminated (SIGTERM).",
		color: "amber",
	},
];

export const commandNodeSchema = z.object({
	...nodeBase,
	...placed,
	type: z.literal("command"),
	/**
	 * Run with `sh -c` in the worktree. The exit code picks the outcome (`exits`). Template values
	 * arrive as environment variables, never as shell text: write
	 * `echo "{{worker.summary}}"` and the shell sees `echo "${NS_WORKER_SUMMARY}"`.
	 */
	command: z.string().min(1),
	/**
	 * `text`: the output is the log tail only. `json`: the command prints
	 * JSON, kept as `data` for later nodes (`{{check.data.tests}}`); output
	 * that is not JSON ends the step on the catch-all exit.
	 */
	output: z.enum(["text", "json"]).default("text"),
	/**
	 * The outcome per exit code, each with an edge. A code without an exit
	 * ends on the catch-all; without a catch-all the step errors. Unset:
	 * `pass` on 0 and `fail` on any other code (`commandExits`).
	 */
	exits: z.array(commandExitSchema).min(1).optional(),
	/**
	 * Secrets by name (Agents → Secrets): each reaches the command as an
	 * environment variable of the same name (`"$ZAC_USER"`). The Device that
	 * runs the step reads them: its keychain, then its daemon's environment.
	 * A secret it does not have errors the step before the command runs.
	 * Their values become `•••` in the step's output, log tail and data.
	 */
	secrets: z.array(secretNameSchema).optional(),
});
export type CommandNode = z.infer<typeof commandNodeSchema>;

/** A Command node's exits: its own, else pass on 0 and fail on any other code. */
export function commandExits(node: Pick<CommandNode, "exits">): CommandExit[] {
	return node.exits ?? LEGACY_COMMAND_EXITS;
}

/**
 * The exit a code ends on: the exit with that code, else the catch-all,
 * else undefined (the step errors). A null code (the command did not start
 * or its JSON is not valid) ends on the catch-all.
 */
export function exitFor(
	node: Pick<CommandNode, "exits">,
	code: number | null,
): CommandExit | undefined {
	const exits = commandExits(node);
	return (
		(code === null ? undefined : exits.find((exit) => exit.code === code)) ??
		exits.find((exit) => exit.code === undefined)
	);
}

/** log_tail: the last lines of stdout and stderr together. data: the JSON it printed, with `output: "json"`. */
export const commandOutputFields = [
	"outcome",
	"exit_code",
	"log_tail",
	"data",
	"visit",
] as const;

/**
 * A Command node's templates read known names, it names each secret once,
 * and its own exits follow the outcome and exit rules.
 */
export function checkCommandNode(node: CommandNode, check: NodeCheck): void {
	check.template(node.command, "command");
	const secrets = new Set<string>();
	for (const name of node.secrets ?? []) {
		if (secrets.has(name)) {
			check.error(
				`Command node "${node.id}" names the secret ${name} more than once.`,
			);
		}
		secrets.add(name);
	}
	if (node.exits !== undefined) {
		checkOptions(
			node.id,
			commandExits(node).map((exit) => exit.name),
			{ title: "Command", kind: "exit", picker: "the command ends on" },
			// A command ends the run on exit 0 and fails it on any other code.
			() => true,
			check,
		);
		checkExits(node, check);
	}
}

/**
 * Each exit code at most once. The catch-all (an exit without a code) at
 * most once and last. Without one, an exit code that is not listed errors
 * the step: a warning.
 */
function checkExits(node: CommandNode, check: NodeCheck): void {
	const codes = new Set<number>();
	const exits = commandExits(node);
	for (const exit of exits) {
		if (exit.code === undefined) continue;
		if (codes.has(exit.code)) {
			check.error(
				`Command node "${node.id}" has the exit code ${exit.code} more than once.`,
			);
		}
		codes.add(exit.code);
	}
	const catchAll = exits.filter((exit) => exit.code === undefined);
	if (catchAll.length > 1) {
		check.error(
			`Command node "${node.id}" has ${catchAll.length} exits without a code (${catchAll.map((e) => `"${e.name}"`).join(", ")}). Keep one: it catches every other code.`,
		);
	} else if (catchAll.length === 1 && exits.at(-1) !== catchAll[0]) {
		check.error(
			`Command node "${node.id}": the exit "${catchAll[0]?.name}" catches every other code. Put it last.`,
		);
	} else if (catchAll.length === 0) {
		check.warning(
			`Command node "${node.id}" has no exit for other codes: the step fails on any code that is not listed.`,
		);
	}
}
