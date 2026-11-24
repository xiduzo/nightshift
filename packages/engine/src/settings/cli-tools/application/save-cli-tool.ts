import type { ComputerAccess } from "../../../access";
import type { Actor } from "../../../contract";
import {
	type CliTool,
	type CliToolInput,
	cliToolSave,
} from "../domain/cli-tool";
import type { SavedCliTools } from "./ports";

export type SaveCliToolPorts = {
	computerAccess: Pick<ComputerAccess, "openComputer">;
	saved: Pick<SavedCliTools, "write">;
	now: () => number;
};

/**
 * Adds a CLI tool, or changes its program, description, login or git
 * host, in one write. It answers the tool as saved. Only the owner of
 * this computer may save it (`computerAccess.openComputer`).
 */
export const saveCliTool =
	(ports: SaveCliToolPorts) =>
	async (actor: Actor, input: CliToolInput): Promise<CliTool> => {
		ports.computerAccess.openComputer(actor);
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
