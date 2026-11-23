/**
 * The assistant: design-time sessions on an Agent Profile in a project's
 * Clone. `wireAssistant` binds the use cases to their adapters.
 */
import { wireAssistant } from "./wire";

const assistant = wireAssistant();

export { wireAssistant } from "./wire";
export type { Assistant } from "./wire";
export { chatCanUseTools, resumesOnAnotherModel } from "./domain/chat-rules";
export {
	CHECK_LIMITS,
	CHECK_PROMPT,
} from "./domain/check-limits";
export type { AgentCheck } from "./domain/check-agent";
export {
	explanationPrompt,
} from "./domain/explain-prompt";
export {
	learnFromRunPrompt,
	MAX_RUN_LEARNINGS,
	reportedLearnings,
	type RunLearnings,
} from "./domain/learn-prompt";
export type { ChatExchange } from "./domain/prompts";
export type {
	AssistantVia,
	SessionLimits,
	AssistantSessionEvent,
} from "./domain/session";
export type {
	AuthoringPort,
	AuthoringRun,
	AuthoringRunStep,
	AuthoringProfile,
} from "./domain/authoring";
export type { HistoryPort } from "./adapters/out/tanstack-history-tools";
export type { TerminalPort } from "./adapters/out/tanstack-terminal-tools";
export type { TerminalProject } from "./domain/terminal-project";
export { chooseProject } from "./domain/terminal-project";
export { knowledgeUri } from "./domain/terminal-knowledge";

export const chatTurn = assistant.chatTurn;
export const checkAgent = assistant.checkAgent;
export const explainRun = assistant.explainRun;
export const learnFromRun = assistant.learnFromRun;
export const serveTools = assistant.serveTools;
export const terminalTools = assistant.terminalTools;
export const terminalResources = assistant.terminalResources;
export const suggestField = assistant.suggestField;