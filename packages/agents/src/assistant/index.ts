/**
 * The assistant: read-only design-time sessions on an Agent Profile, in a
 * project's Clone, that help a person build a flow: a suggestion for one
 * field of one node (`suggestField`), and one turn of a chat about the
 * whole flow (`chatTurn`) with the authoring tools over an `AuthoringPort`.
 * The same tools for an agent in a terminal (`terminalTools`), served over
 * MCP by `nightshift mcp` (`serveTools`).
 */
export {
	chatCanUseTools,
	chatTurn,
	resumesOnAnotherModel,
} from "./chat";
export { serveTools } from "./mcp";
export type { ChatExchange } from "./prompts";
export { type SuggestFieldInput, suggestField } from "./suggest";
export {
	type TerminalPort,
	type TerminalProject,
	type TerminalRunSummary,
	terminalTools,
} from "./terminal";
export type { AuthoringPort, AuthoringRun, AuthoringRunStep } from "./tools";
