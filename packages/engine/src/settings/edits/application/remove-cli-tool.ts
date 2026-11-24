import type { ComputerAccess } from "../../../access";
import type { Actor } from "../../../contract";
import type { CliToolStore } from "../../cli-tools";
import type { ProfileStore } from "../../profiles";
import { rewriteProfiles } from "../domain/profile-edits";

export type RemoveCliToolPorts = {
	computerAccess: Pick<ComputerAccess, "openComputer">;
	cliTools: Pick<CliToolStore, "remove">;
	profiles: Pick<ProfileStore, "list" | "save">;
};

/**
 * Removes a CLI tool, and takes it off the profiles that name it. Only the
 * owner of this computer may (`computerAccess.openComputer`).
 */
export const removeCliTool =
	(ports: RemoveCliToolPorts) =>
	async (actor: Actor, request: { name: string }): Promise<void> => {
		ports.computerAccess.openComputer(actor);
		const { name } = request;
		await ports.cliTools.remove(name);
		await rewriteProfiles(ports.profiles, (p) =>
			p.clis.includes(name) ? { clis: p.clis.filter((c) => c !== name) } : null,
		);
	};
