/**
 * The guided setup of an agent CLI on this computer (ADR 25): the vendor's
 * installer, the CLI's own sign-in, and the harness with a profile. Then
 * the setup of a decider (Q22): Ollama with its small model, or a TypeSafe
 * key. The daemon runs them, the API's `agentSetup` and `deciderSetup`
 * routes call them.
 */

export type {
	AgentSetupCaller,
	AgentSetupStatus,
	AgentSetupView,
} from "./domain/agent-status";
export type { OllamaInstall } from "./domain/decider-plan";
export type { DeciderSetupStatus } from "./domain/decider-status";
export type { AgentSetupJob, DeciderSetupJob } from "./domain/setup-jobs";
export type { AgentSetupBlock } from "./domain/setup-place";
export type {
	AgentSetup,
	AgentSetupDeps,
	DeciderSetup,
	DeciderSetupDeps,
	SignInCheck,
} from "./wire";
export { type AgentSetupWireDeps, wireAgentSetup } from "./wire";
