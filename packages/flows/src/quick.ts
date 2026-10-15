import type { AgentNode, Flow } from "./schema";

/** A one-node flow for a quick run from a prompt. */
export function singleAgentFlow(
	input: Pick<AgentNode, "prompt" | "model" | "permissionMode"> &
		Partial<Pick<AgentNode, "effort" | "skill">>,
): Flow {
	throw new Error("Not implemented");
}
