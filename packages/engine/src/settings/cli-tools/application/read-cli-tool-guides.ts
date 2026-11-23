import {
	type CliToolGuide,
	guideOf,
	helpProgramOf,
} from "../domain/cli-tool-guides";
import type { ProgramHelp, SavedCliTools } from "./ports";

export type ReadCliToolGuidesPorts = {
	saved: Pick<SavedCliTools, "read">;
	programs: ProgramHelp;
};

/**
 * What an agent learns about the tools of these names when its session
 * starts: each description, and the program's own help. A name no tool
 * has is a program. The helps are read at the same time.
 */
export const readCliToolGuides =
	(ports: ReadCliToolGuidesPorts) =>
	(request: { names: readonly string[] }): Promise<CliToolGuide[]> =>
		Promise.all(
			request.names.map(async (name) => {
				const tool = ports.saved.read().get(name);
				return guideOf(
					name,
					tool,
					await ports.programs.help(helpProgramOf(name, tool)),
				);
			}),
		);
