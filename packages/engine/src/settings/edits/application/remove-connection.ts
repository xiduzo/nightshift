import type { Actor } from "../../../contract";
import type { ConnectionStore } from "../../connections";
import type { ProfileStore } from "../../profiles";
import { removeConnection as removeConnectionStep } from "../domain/tool-edits";

export type RemoveConnectionPorts = {
	connections: Pick<ConnectionStore, "remove">;
	profiles: Pick<ProfileStore, "list" | "save">;
};

/** Removes a connection, and takes it off the profiles that name it. */
export const removeConnection =
	(ports: RemoveConnectionPorts) =>
	(_actor: Actor, request: { name: string }): Promise<void> =>
		removeConnectionStep(ports, request.name);
