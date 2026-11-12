/**
 * This computer's own configuration, private to its owner: the settings,
 * the harnesses and deciders, Agent Profiles, connections and CLI tools,
 * the Ollama search by meaning uses, and the guided setup of an agent.
 */
export { agentSetup } from "./agent-setup";
export { cliTools } from "./cli-tools";
export { connections } from "./connections";
export { programs } from "./found-programs";
export { deciders, harnesses } from "./harnesses";
export { ollama } from "./ollama";
export { profiles } from "./profiles";
export { deviceProfileSchema, secretScopeSchema } from "./schemas";
export { settings } from "./settings";
