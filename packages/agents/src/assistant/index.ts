/**
 * The assistant: design-time sessions on an Agent Profile in a project's
 * Clone. `wireAssistant` binds the use cases to their adapters.
 */

export type { TerminalPort } from "./application/terminal-resources";
export type { ChatExchange } from "./catalog";
export { chatCanUseTools, resumesOnAnotherModel } from "./catalog";
export type {
	AuthoringPort,
	AuthoringRun,
	AuthoringRunStep,
} from "./domain/authoring";
export type { HistoryPort } from "./domain/history-port";
export type { AssistantVia } from "./sessions";
export type { TerminalProject } from "./terminal";
export { chooseProject } from "./terminal";
export { wireAssistant } from "./wire";
