/**
 * The guided setup of an agent CLI on this computer (ADR 25): the vendor's
 * installer, the CLI's own sign-in, and the harness with a profile. The
 * daemon runs it, the API's `agentSetup` routes call it. Also the PATH fix
 * the daemon makes before it starts.
 */
export {
	type AgentSetup,
	type AgentSetupJob,
	type AgentSetupStatus,
	type AgentSetupView,
	createAgentSetup,
} from "./agent-setup";
export { putAgentBinsOnPath } from "./bin-path";
