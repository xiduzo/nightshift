/**
 * Words and pure helpers the Device uses for CLI tools and missing secrets.
 * Kept here so the device mechanism does not import the settings capability.
 */
import type { Login } from "@nightshift/flows";
import type { NotRead } from "../contract";

export const NOT_ON_THIS_COMPUTER =
	"This project is not on this computer. Add its folder here to use it.";

/** What a person reads when a step needs Project secrets that cannot be read now. */
const PROJECT_UNREACHABLE =
	"Night Shift could not read this project's secrets now. Check that this computer is online, then try again.";

/** What a person reads when a use needs Personal secrets that cannot be read now. */
const PERSONAL_UNREACHABLE =
	"Night Shift could not read your Personal secrets now. Check that this computer is online, then try again.";

/** Personal secrets do not work on the Host. */
const PERSONAL_ON_HOST =
	"Personal secrets do not work on the Host. Move it to the Space or the project.";

export type DeviceCliTool = {
	name: string;
	program: string | null;
	description: string | null;
	login: Login | null;
	git: { host: string; helper: string } | null;
	updatedAt: number;
};

export type DeviceCliToolGuide = {
	name: string;
	program?: string;
	login?: boolean;
	description: string | null;
	help: string | null;
};

/** The program a CLI tool runs. */
export const programOf = (
	tool: Pick<DeviceCliTool, "name" | "program">,
): string => tool.program ?? tool.name;

/**
 * What an agent learns about the CLI tools of this computer when its
 * session starts.
 */
export function cliToolsInstruction(
	tools: readonly DeviceCliToolGuide[],
): string {
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

/**
 * The sentences a missing-secret message ends with when the Project or
 * the Personal secrets could not be read.
 */
export function unreachableNote(found: NotRead): string {
	return [
		found.projectUnreachable ? ` ${PROJECT_UNREACHABLE}` : "",
		found.unreachable ? ` ${PERSONAL_UNREACHABLE}` : "",
		found.personalHere ? ` ${PERSONAL_ON_HOST}` : "",
	].join("");
}
