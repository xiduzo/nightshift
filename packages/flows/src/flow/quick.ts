import type { AgentNode, HarnessName } from "../nodes";
import { FLOW_VERSION, type Flow } from "./flow";

/** The harness a quick run's agent runs on when it names neither a profile nor a harness. */
export const QUICK_RUN_HARNESS: HarnessName = "claude-code";

/**
 * A one-node flow for a quick run from a prompt. The agent is an Agent
 * Profile with optional overrides, or a harness and a model. Without a
 * profile, the harness is `QUICK_RUN_HARNESS` unless one is given.
 */
export function singleAgentFlow(
	input: Pick<AgentNode, "prompt" | "permissionMode"> &
		Partial<
			Pick<AgentNode, "profile" | "harness" | "model" | "effort" | "skill">
		>,
): Flow {
	const model = input.model?.trim() || undefined;
	if (input.profile === undefined && model === undefined)
		throw new Error("Choose a profile or a model.");
	const node: AgentNode = {
		id: "agent",
		type: "agent",
		position: { x: 0, y: 0 },
		prompt: input.prompt,
		...(input.profile !== undefined ? { profile: input.profile } : {}),
		...(input.profile === undefined || input.harness !== undefined
			? { harness: input.harness ?? QUICK_RUN_HARNESS }
			: {}),
		...(model !== undefined ? { model } : {}),
		...(input.permissionMode !== undefined
			? { permissionMode: input.permissionMode }
			: {}),
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
