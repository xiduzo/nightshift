/**
 * The guided setup of an agent CLI on this computer (ADR 25): the vendor's
 * installer, the CLI's own sign-in, and the harness with a profile. Then
 * the setup of a decider (Q22): Ollama with its small model, or a TypeSafe
 * key. The daemon runs them, the API's `agentSetup` and `deciderSetup`
 * routes call them. Also the PATH fix the daemon makes before it starts.
 */
export {
	type AgentSetup,
	type AgentSetupJob,
	type AgentSetupStatus,
	type AgentSetupView,
	createAgentSetup,
} from "./agent-setup";
export { putAgentBinsOnPath } from "./bin-path";
export {
	createDeciderSetup,
	type DeciderSetup,
	type DeciderSetupJob,
	type DeciderSetupStatus,
} from "./decider";
