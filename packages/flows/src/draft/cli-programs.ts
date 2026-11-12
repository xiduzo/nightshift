/** Programs that a command calls by their own name while only other CLI tools sign in to them. */
import { type FlowNode, nodeTexts } from "../flow";

/** A CLI tool, as a check reads it. `program` null: the tool runs the program of its own name. */
export type CliToolRef = {
	name: string;
	program: string | null;
	/** Whether the tool has a login: only then does a command get it. */
	signsIn: boolean;
};

/** A program a command calls without a login, with the tools that sign in to it. */
export type ProgramWithoutLogin = { program: string; tools: string[] };

/**
 * The shell commands a node runs, as its type declares them
 * (`NodeDefinition.texts`): a Command's, the one a Wait runs until it
 * passes, the one that prints a Call node's list, an Agent's check, and a
 * Service's start, ready and stop commands.
 */
export function commandsOf(node: FlowNode): string[] {
	return nodeTexts(node).flatMap((text) =>
		text.kind === "command" ? [text.text] : [],
	);
}

/**
 * The programs the node's commands call by their own name, such as `acli`,
 * that only tools of another name sign in to, such as `acli-work`. A
 * command gets a tool with a login under the tool's name, so `acli` runs
 * without one. A tool named after its program, with a login, signs it in.
 */
export function programsWithoutLogin(
	node: FlowNode,
	tools: readonly CliToolRef[],
): ProgramWithoutLogin[] {
	const lines = commandsOf(node).flatMap((command) =>
		command.split("\n").map(withoutComment),
	);
	if (lines.length === 0) return [];
	const byProgram = new Map<string, string[]>();
	for (const tool of tools) {
		if (!tool.signsIn) continue;
		const program = tool.program ?? tool.name;
		byProgram.set(program, [...(byProgram.get(program) ?? []), tool.name]);
	}
	const found: ProgramWithoutLogin[] = [];
	for (const [program, names] of byProgram) {
		if (names.includes(program)) continue;
		const call = callPattern(program);
		if (lines.some((line) => call.test(line))) {
			found.push({ program, tools: names.sort() });
		}
	}
	return found.sort((a, b) => a.program.localeCompare(b.program));
}

/** The line up to a `#` that starts a shell comment. */
export const withoutComment = (line: string) =>
	line.replace(/(^|\s)#.*$/, "$1");

/**
 * The program in a place where the shell runs it: at the start of a line,
 * after `;`, `&`, `|`, `(`, `$(`, a backtick, a keyword such as `then` or a
 * `!` that negates it, after variables set for it (`A=1 acli`), and not as
 * part of a longer name. The pattern has no capturing group.
 */
export function callPattern(program: string): RegExp {
	const name = program.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const start = String.raw`(?:^|[;&|(\x60{]|\$\(|\b(?:then|do|else|elif|if|while|until|exec|xargs|time|command|env|nohup|sudo)\s)`;
	return new RegExp(
		String.raw`${start}\s*(?:!\s+)?(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*${name}(?![\w.-])`,
	);
}
