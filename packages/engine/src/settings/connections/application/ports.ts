import type { SecretUse } from "../../../contract";
import type { notRead, SecretSource } from "../../../secrets";
import type {
	ConnectionEntry,
	SavedConnection,
} from "../domain/saved-connection";

/**
 * The connections in this computer's Device document. A read is
 * synchronous: the start check of a run reads the names.
 */
export type SavedConnections = {
	/** The connections that parse, by name. An entry this version cannot read is left out. */
	read(): ReadonlyMap<string, SavedConnection>;
	/** Adds or replaces the connection of `name`, in one change of the document. */
	write(name: string, entry: ConnectionEntry): Promise<void>;
	/** Removes the connection of `name`, in one change of the document. */
	remove(name: string): Promise<void>;
};

/**
 * The secrets a connection's `${NAME}` references read: the values for one
 * use, the note of the use, and where a name gets its value.
 * @filledBy engine/secrets
 */
export type ConnectionSecrets = {
	/** The values of `names` for one use, and which scopes could not be read. Not a use. */
	resolveSecrets(request: {
		names: Iterable<string>;
		use?: SecretUse;
	}): Promise<Parameters<typeof notRead>[0]>;
	/** Notes a use of these names. Never waits, never fails. */
	noteSecretUse(names: Iterable<string>): void;
	/** Where a name gets its value, as this computer knows the Personal names now. */
	secretSource(name: string): SecretSource;
};
