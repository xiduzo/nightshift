import type {
	AgentSessionInput,
	StepReportSpec,
} from "@nightshift/agents/types";
import type { AgentNode } from "@nightshift/flows";
import { ASK_CHOICES } from "./agent-ask";

/**
 * What an Agent node asks its agent to report: the outcomes it may name,
 * and the report spec the harness gets. An agent that asks a person may
 * report `needs-input` too.
 */

const BUILT_IN_AGENT_OUTCOMES = ["pass", "fail", "needs-input"];

/** The outcomes an Agent node may report: with `ask`, `needs-input` too. */
export function agentOutcomes(node: AgentNode): string[] {
	const own = node.outcomes?.map((o) => o.name) ?? BUILT_IN_AGENT_OUTCOMES;
	return node.ask === "person" && !own.includes("needs-input")
		? [...own, "needs-input"]
		: own;
}

/**
 * The outcome an agent that asks a person reports for its questions, next
 * to its own outcomes.
 */
export const ASK_OUTCOME = {
	name: "needs-input",
	description:
		"You need a person to answer before you can go on. Put your questions in your final message.",
};

/**
 * What the harness asks the agent to report: a spec for own outcomes or an
 * output schema. An agent that asks a person may report `needs-input` too,
 * with the description that tells it where its questions go.
 */
export function stepReportOf(node: AgentNode): AgentSessionInput["stepReport"] {
	if (!node.outcomes && !node.output && node.ask === undefined) return true;
	const spec: StepReportSpec = {};
	if (node.outcomes || node.ask === "person") {
		const own = (node.outcomes ?? BUILT_IN_OUTCOMES).map((o) =>
			o.description === undefined
				? { name: o.name }
				: { name: o.name, description: o.description },
		);
		spec.outcomes =
			node.ask === "person"
				? [...own.filter((o) => o.name !== ASK_OUTCOME.name), ASK_OUTCOME]
				: own;
	}
	if (node.ask === "person") {
		spec.ask = {
			outcome: ASK_OUTCOME.name,
			choices: ASK_CHOICES.map((choice) => choice.name),
		};
	}
	if (node.output) spec.output = node.output;
	return spec;
}

/** The built-in outcomes, as an agent that asks a person reads them. */
const BUILT_IN_OUTCOMES = [
	{ name: "pass", description: "The task is done." },
	{ name: "fail", description: "The task is not done." },
];
