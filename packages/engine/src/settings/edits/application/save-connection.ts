import type { ComputerAccess } from "../../../access";
import type { Actor } from "../../../contract";
import type {
	Connection,
	ConnectionInput,
	ConnectionStore,
} from "../../connections";
import type { ProfileStore } from "../../profiles";
import { saveConnection as saveConnectionStep } from "../domain/tool-edits";

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
		return saveConnectionStep(ports, request.connection, request.previousName);
	};
