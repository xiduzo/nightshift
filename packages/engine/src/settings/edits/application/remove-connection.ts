import type { Actor } from "../../../contract";
import { removeConnection as removeConnectionStep } from "../domain/tool-edits";
import type { EditedConnections, EditedProfiles } from "./ports";

export type RemoveConnectionPorts = {
	connections: Pick<EditedConnections, "remove">;
	profiles: Pick<EditedProfiles, "list" | "save">;
};

/** Removes a connection, and takes it off the profiles that name it. */
export const removeConnection =
	(ports: RemoveConnectionPorts) =>
	(_actor: Actor, request: { name: string }): Promise<void> =>
		removeConnectionStep(ports, request.name);
