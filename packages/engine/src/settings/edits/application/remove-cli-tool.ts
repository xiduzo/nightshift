import type { Actor } from "../../../contract";
import type { CliToolStore } from "../../cli-tools";
import type { ProfileStore } from "../../profiles";
import { removeCliTool as removeCliToolStep } from "../domain/tool-edits";

export type RemoveCliToolPorts = {
	cliTools: Pick<CliToolStore, "remove">;
	profiles: Pick<ProfileStore, "list" | "save">;
};

/** Removes a CLI tool, and takes it off the profiles that name it. */
export const removeCliTool =
	(ports: RemoveCliToolPorts) =>
	(_actor: Actor, request: { name: string }): Promise<void> =>
		removeCliToolStep(ports, request.name);
