/** The connections of this computer: MCP servers named by Agent nodes, with their `${NAME}` references, and the secrets they read. */

export { unreachableNote } from "../../secrets";
export type { Connection } from "./application/write-connection";
export {
	type ConnectionInput,
	connectionInputSchema,
} from "./domain/saved-connection";
export {
	type ConnectionStore,
	type SecretBackend,
	type SecretEdits,
	wireConnections,
} from "./wire";
