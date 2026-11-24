/**
 * The assistant: design-time sessions on an Agent Profile in a project's
 * Clone. `wireAssistant` binds the use cases to their adapters.
 */

export type { AssistantVia } from "./application/explain-run";
export type { ChatExchange } from "./catalog";
export { chatCanUseTools, resumesOnAnotherModel } from "./catalog";
export type {
	AuthoringPort,
	AuthoringRun,
	AuthoringRunStep,
} from "./domain/authoring";
export type { HistoryPort } from "./domain/history-port";
export type { TerminalPort, TerminalProject } from "./terminal";
export { chooseProject } from "./terminal";
export { wireAssistant } from "./wire";
