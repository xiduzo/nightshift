import type { AgentNode, HarnessName } from "../nodes";
import { FLOW_VERSION, type Flow } from "./flow";

/** The harness a quick run's agent runs on. */
export const QUICK_RUN_HARNESS: HarnessName = "claude-code";

/** A one-node flow for a quick run from a prompt. */
export function singleAgentFlow(
	input: Pick<AgentNode, "prompt" | "model" | "permissionMode"> &
		Partial<Pick<AgentNode, "effort" | "skill">>,
): Flow {
	const node: AgentNode = {
		id: "agent",
		type: "agent",
		position: { x: 0, y: 0 },
		prompt: input.prompt,
		harness: QUICK_RUN_HARNESS,
		model: input.model,
		permissionMode: input.permissionMode,
		session: "fresh",
	};
	if (input.effort !== undefined) node.effort = input.effort;
	if (input.skill !== undefined) node.skill = input.skill;
	return {
		version: FLOW_VERSION,
		inputs: [],
		outputs: [],
		start: "agent",
		nodes: [node],
		edges: [],
	};
}
