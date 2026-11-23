import type { SecretSource } from "../../../secrets";
import {
	type ConnectionInput,
	connectionSave,
	type SavedConnection,
	withVariables,
} from "../domain/saved-connection";
import type { ConnectionSecrets, SavedConnections } from "./ports";

export type WriteConnectionPorts = {
	saved: Pick<SavedConnections, "write">;
	secrets: Pick<ConnectionSecrets, "secretSource">;
	now: () => number;
};

/** A connection, with the `${NAME}` references in its env values and headers. */
export type Connection = SavedConnection & {
	variables: { name: string; source: SecretSource }[];
};

/**
 * Creates or replaces a connection, in one write. It checks nothing but
 * the shape: the edits of a person check the name first
 * (`saveConnection` of `edits`). It answers the connection as saved, with
 * where each of its references gets its value.
 */
export const writeConnection =
	(ports: WriteConnectionPorts) =>
	async (input: ConnectionInput): Promise<Connection> => {
		const saved = connectionSave(input, ports.now);
		await ports.saved.write(saved.name, {
			description: saved.description,
			server: saved.server,
			updatedAt: saved.updatedAt,
		});
		return withVariables(saved, ports.secrets.secretSource);
	};
