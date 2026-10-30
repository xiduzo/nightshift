import { z } from "zod";
import {
	labelSchema,
	type NodeCheck,
	nodeBase,
	placed,
	secretNameSchema,
} from "./base";
import { checkOptions, outcomeColorSchema } from "./outcomes";

/**
 * The Command node: a shell command. Its data or its exit code picks the
 * outcome.
 */

/**
 * The `code` of an exit that only the command's data picks: the command
 * writes `{ "outcome": "<name>" }` to `$NS_OUTPUT`. It has no exit code
 * and is not the catch-all.
 */
export const DATA_EXIT_CODE = "data";

/**
 * One exit of a Command node: an exit code and the outcome it ends with.
 * The exit without a `code` is the catch-all: any other code, a command
 * that cannot start, and data that is not valid JSON. At most one, last.
 * An exit with the code `"data"` is picked by the command's data only
 * (`dataExitFor`).
 */
export const commandExitSchema = z.object({
	name: labelSchema,
	code: z
		.union([z.number().int().min(0).max(255), z.literal(DATA_EXIT_CODE)])
		.optional(),
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
	 *
	 * `$NS_OUTPUT` names a new, empty file for the step's data, as
	 * `$GITHUB_OUTPUT` does in GitHub Actions. JSON written there is the
	 * step's `data`, whatever `output` says and whatever the exit code; a
	 * file that is not valid JSON ends the step on the catch-all. stdout
	 * stays the log. Data that is an object with an `outcome` that names
	 * one of the node's exits ends the step on that exit (`dataExitFor`).
	 */
	command: z.string().min(1),
	/**
	 * Where the data comes from when the command leaves `$NS_OUTPUT` empty.
	 * `text`: there is none, the output is the log tail only. `json`: the
	 * command prints JSON on stdout, kept as `data` for later nodes
	 * (`{{check.data.tests}}`); output that is not JSON ends the step on
	 * the catch-all exit. The older way: one stray `echo` breaks it.
	 */
	output: z.enum(["text", "json"]).default("text"),
	/**
	 * The outcome per exit code, each with an edge. A code without an exit
	 * ends on the catch-all; without a catch-all the step errors. An exit
	 * with the code `"data"` only ends the step when the data names it.
	 * Unset: `pass` on 0 and `fail` on any other code (`commandExits`).
	 */
	exits: z.array(commandExitSchema).min(1).optional(),
	/**
	 * Secrets by name (Agents → Secrets): each reaches the command as an
	 * environment variable of the same name (`"$ZAC_USER"`). The Device that
	 * runs the step reads them: its keychain, then its daemon's environment.
	 * A secret it does not have errors the step before the command runs.
	 * Their values become `•••` in the step's output, log tail and data.
	 * A CLI tool with a login needs none of its secrets here: `gh` in the
	 * command runs as the gh tool.
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
 * or its JSON is not valid) ends on the catch-all. An exit picked by data
 * matches no code.
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

/**
 * The exit the step's data picks: data that is an object whose `outcome`
 * names one of the node's exits, any exit. Else undefined, and the exit
 * code picks. A command not written for Night Shift writes no data, so its
 * exit codes keep working.
 */
export function dataExitFor(
	node: Pick<CommandNode, "exits">,
	data: unknown,
): CommandExit | undefined {
	if (typeof data !== "object" || data === null || Array.isArray(data)) {
		return undefined;
	}
	const outcome = (data as Record<string, unknown>).outcome;
	if (typeof outcome !== "string") return undefined;
	return commandExits(node).find((exit) => exit.name === outcome);
}

/**
 * Whether the command ends on `outcome` by its own choice: its exit on
 * code 0, or an exit only its data picks. Its other exits, the catch-all
 * among them, are failures.
 */
export function isChosenExit(
	node: Pick<CommandNode, "exits">,
	outcome: string,
): boolean {
	return commandExits(node).some(
		(exit) =>
			exit.name === outcome &&
			(exit.code === 0 || exit.code === DATA_EXIT_CODE),
	);
}

/**
 * Whether later nodes can read the command's `data`: it prints JSON
 * (`output: "json"`), or it names `$NS_OUTPUT`, the file for its data.
 */
export function commandHasData(
	node: Pick<CommandNode, "command" | "output">,
): boolean {
	return node.output === "json" || node.command.includes("NS_OUTPUT");
}

/**
 * log_tail: the last lines of stdout and stderr together. data: the JSON
 * the command wrote to `$NS_OUTPUT`, else the JSON it printed with
 * `output: "json"`.
 */
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
		if (exit.code === undefined || exit.code === DATA_EXIT_CODE) continue;
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
			`Command node "${node.id}" has no exit for other codes: the step fails on any other code.`,
		);
	}
}
