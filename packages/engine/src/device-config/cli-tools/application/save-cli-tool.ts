import type { Actor } from "../../../contract";
import {
	type CliTool,
	type CliToolInput,
	cliToolSave,
} from "../domain/cli-tool";
import type { SavedCliTools } from "./ports";

export type SaveCliToolPorts = {
	saved: Pick<SavedCliTools, "write">;
	now: () => number;
};

/**
 * Adds a CLI tool, or changes its program, description, login or git
 * host, in one write. It answers the tool as saved. The owner of this
 * computer may save it: its door checks that (`ownerProcedure`), so the
 * actor is not read here.
 */
export const saveCliTool =
	(ports: SaveCliToolPorts) =>
	async (_actor: Actor, input: CliToolInput): Promise<CliTool> => {
		const tool = cliToolSave(input, ports.now);
		await ports.saved.write(tool.name, {
			description: tool.description,
			program: tool.program,
			login: tool.login,
			git: tool.git,
			updatedAt: tool.updatedAt,
		});
		return tool;
	};
