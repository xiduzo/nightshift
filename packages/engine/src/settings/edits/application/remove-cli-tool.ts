import type { Actor } from "../../../contract";
import { removeCliTool as removeCliToolStep } from "../domain/tool-edits";
import type { EditedCliTools, EditedProfiles } from "./ports";

export type RemoveCliToolPorts = {
	cliTools: Pick<EditedCliTools, "remove">;
	profiles: Pick<EditedProfiles, "list" | "save">;
};

/** Removes a CLI tool, and takes it off the profiles that name it. */
export const removeCliTool =
	(ports: RemoveCliToolPorts) =>
	(_actor: Actor, request: { name: string }): Promise<void> =>
		removeCliToolStep(ports, request.name);
