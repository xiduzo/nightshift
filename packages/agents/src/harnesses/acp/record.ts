import type { HarnessAdapter } from "../harness-record";
import { ACP_DEFAULT_MODEL, ACP_FACTS, type AcpAgentName } from "./facts";
import { piCheck, piModels } from "./pi";

/**
 * The ACP agents in the harness registry. `@tanstack/ai-acp` knows no
 * models: the agent's own setting (`default`) is the one in the list.
 */
export const ACP_ADAPTERS: Record<AcpAgentName, HarnessAdapter> = {
	copilot: { ...ACP_FACTS.copilot, models: [ACP_DEFAULT_MODEL] },
	gemini: { ...ACP_FACTS.gemini, models: [ACP_DEFAULT_MODEL] },
	cursor: { ...ACP_FACTS.cursor, models: [ACP_DEFAULT_MODEL] },
	pi: {
		...ACP_FACTS.pi,
		models: [ACP_DEFAULT_MODEL],
		parseListing: piModels,
		check: piCheck,
	},
};
