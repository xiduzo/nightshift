/** Fields that fall back to a default: shared by Agent, Decision and Value nodes. */
import type { AgentNode, DecisionNode, ValueNode } from "@nightshift/flows";

/**
 * The node without one of its optional fields: it comes from the default
 * again (an Agent node's profile, a Decision or Value node's decider).
 */
export function withoutField<N extends AgentNode | DecisionNode | ValueNode>(
	node: N,
	key: "harness" | "model" | "effort" | "permissionMode",
): N {
	const { [key as keyof N]: _dropped, ...rest } = node;
	return rest as N;
}

/**
 * The hint under a decider's model field. A decider that lists the models
 * on this computer (Ollama) says how many lead the list, or why it could not.
 */
export function deciderModelHint(
	decider: { listed: number; listProblem: string | null } | undefined,
): string {
	const base = "Leave it empty to use the decider's default model.";
	if (decider?.listProblem) return `${base} ${decider.listProblem}`;
	if (decider && decider.listed > 0) {
		return `${base} The first ${decider.listed} in the list are on this computer.`;
	}
	return base;
}
