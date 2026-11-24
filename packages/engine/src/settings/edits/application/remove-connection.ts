import type { ComputerAccess } from "../../../access";
import type { Actor } from "../../../contract";
import type { ConnectionStore } from "../../connections";
import type { ProfileStore } from "../../profiles";
import { rewriteProfiles } from "../domain/profile-edits";

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
		const { name } = request;
		await ports.connections.remove(name);
		await rewriteProfiles(ports.profiles, (p) =>
			p.connections.includes(name)
				? { connections: p.connections.filter((c) => c !== name) }
				: null,
		);
	};
