import { Refusal } from "@nightshift/refusal";
import type { ComputerAccess } from "../../../access";
import type { Actor } from "../../../contract";
import type {
	Connection,
	ConnectionInput,
	ConnectionStore,
} from "../../connections";
import type { ProfileStore } from "../../profiles";
import { connectionTaken, rewriteProfiles } from "../domain/profile-edits";

export type SaveConnectionPorts = {
	computerAccess: Pick<ComputerAccess, "openComputer">;
	connections: Pick<ConnectionStore, "get" | "save" | "remove">;
	profiles: Pick<ProfileStore, "list" | "save">;
};

/**
 * Adds a connection, or changes or renames one (`previousName`). A rename
 * moves the profiles that name the old name to the new one. Refused when
 * another connection has the name.
 * Only the owner of this computer may (`computerAccess.openComputer`).
 */
export const saveConnection =
	(ports: SaveConnectionPorts) =>
	async (
		actor: Actor,
		request: { connection: ConnectionInput; previousName?: string },
	): Promise<Connection> => {
		ports.computerAccess.openComputer(actor);
		const { connection, previousName } = request;
		if (
			previousName !== connection.name &&
			ports.connections.get(connection.name)
		) {
			throw new Refusal("conflict", connectionTaken(connection.name));
		}
		const saved = await ports.connections.save(connection);
		if (previousName && previousName !== connection.name) {
			await ports.connections.remove(previousName);
			await rewriteProfiles(ports.profiles, (p) =>
				p.connections.includes(previousName)
					? {
							connections: p.connections.map((c) =>
								c === previousName ? connection.name : c,
							),
						}
					: null,
			);
		}
		return saved;
	};
