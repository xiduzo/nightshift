import { type CliTool, programOf } from "./cli-tool";

/** What an agent learns about one of its CLI tools when its session starts. */
export type CliToolGuide = {
	name: string;
	/** The program it runs, when that is not its name. */
	program?: string;
	/** It has a login of its own: a separate account. */
	login?: boolean;
	description: string | null;
	/** The program's own help (`--help`). Null when it has none. */
	help: string | null;
};

/** The program whose help a guide quotes: the tool's program, or a program of that name. */
export function helpProgramOf(name: string, tool: CliTool | undefined): string {
	return tool ? programOf(tool) : name;
}

/** The guide of the tool of `name`, with its program's help. */
export function guideOf(
	name: string,
	tool: CliTool | undefined,
	help: string | null,
): CliToolGuide {
	return {
		name,
		...(tool?.program ? { program: tool.program } : {}),
		...(tool?.login ? { login: true } : {}),
		description: tool?.description ?? null,
		help,
	};
}

/**
 * The prompt section that tells an agent which CLI tools it has: each
 * name, the description its owner wrote, and the program's help. The help
 * is quoted in a fence longer than any backtick run inside it.
 */
export function cliToolsInstruction(tools: readonly CliToolGuide[]): string {
	if (tools.length === 0) return "";
	const sections = tools.map((tool) => {
		const lines = [`### ${tool.name}`];
		if (tool.description) lines.push("", tool.description);
		if (tool.program && tool.program !== tool.name) {
			lines.push(
				"",
				`\`${tool.name}\` runs \`${tool.program}\`${tool.login ? " with its own login" : ""}. Type \`${tool.name}\` where you would type \`${tool.program}\`.`,
			);
		}
		if (tool.help) {
			const longest = Math.max(
				0,
				...(tool.help.match(/`+/g) ?? []).map((run) => run.length),
			);
			const fence = "`".repeat(Math.max(3, longest + 1));
			lines.push(
				"",
				`\`${tool.name} --help\`:`,
				"",
				`${fence}text`,
				tool.help,
				fence,
			);
		}
		return lines.join("\n");
	});
	return [
		"## CLI tools",
		"",
		"You can run these programs in your shell. Use them instead of guessing at an API. For the details of one command, run it with `--help`.",
		"",
		sections.join("\n\n"),
	].join("\n");
}
