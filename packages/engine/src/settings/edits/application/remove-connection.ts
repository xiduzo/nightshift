import type { ComputerAccess } from "../../../access";
import type { Actor } from "../../../contract";
import type { ConnectionStore } from "../../connections";
import type { ProfileStore } from "../../profiles";
import { removeConnection as removeConnectionStep } from "../domain/tool-edits";

export type RemoveConnectionPorts = {
	computerAccess: Pick<ComputerAccess, "openComputer">;
	connections: Pick<ConnectionStore, "remove">;
	profiles: Pick<ProfileStore, "list" | "save">;
};

/**
 * Removes a connection, and takes it off the profiles that name it. Only the
 * owner of this computer may (`computerAccess.openComputer`).
 */
export const removeConnection =
	(ports: RemoveConnectionPorts) =>
	async (actor: Actor, request: { name: string }): Promise<void> => {
		ports.computerAccess.openComputer(actor);
		return removeConnectionStep(ports, request.name);
	};
