import {
	agentOutputFields,
	type CallEachNode,
	callEachOutputFields,
	callOutputFields,
	commandExits,
	commandOutputFields,
	decisionOutputFields,
	endOutputFields,
	type OutcomeColor,
	toolOutputFields,
	valueOutputFields,
	waitOutputFields,
} from "../nodes";
import type { Flow, FlowNode, FlowNodeType, Outcome } from "./flow";

/**
 * What any node of a flow ends with and gives later nodes. Each node type
 * keeps its own part in `nodes/`. These pick the part by the node's type.
 */

/** Whether the node is a Call node that runs its flow once per element. */
export function runsEach(node: FlowNode): node is CallEachNode {
	return node.type === "call" && node.each !== undefined;
}

/** The outcomes a node can end with, in the order its handles show. */
export function nodeOutcomes(node: FlowNode): readonly Outcome[] {
	switch (node.type) {
		case "agent": {
			const outcomes = node.outcomes
				? node.outcomes.map((o) => o.name)
				: ["pass", "fail", "needs-input"];
			// An agent that asks a person never ends on needs-input.
			return node.ask === "person"
				? outcomes.filter((name) => name !== "needs-input")
				: outcomes;
		}
		case "command":
			return commandExits(node).map((exit) => exit.name);
		case "decision":
			return node.options.map((option) => option.name);
		case "call":
			return node.each
				? ["done", "halted", "stopped"]
				: ["pass", "fail", "stopped"];
		case "value":
			return ["pass", "fail"];
		case "wait":
			return ["done", "timeout"];
		case "tool":
			return ["pass", "fail"];
		case "end":
			// No edge leaves an End node: the run ends there.
			return [];
	}
}

/** The colour a node gives one of its outcomes, or undefined when it sets none. */
export function outcomeColor(
	node: FlowNode,
	outcome: Outcome,
): OutcomeColor | undefined {
	switch (node.type) {
		case "agent":
			return node.outcomes?.find((o) => o.name === outcome)?.color;
		case "command":
			return commandExits(node).find((exit) => exit.name === outcome)?.color;
		case "decision":
			return node.options.find((option) => option.name === outcome)?.color;
		default:
			return undefined;
	}
}

/**
 * The fields a later node can read with `{{<nodeId>.<field>}}`. A field of a
 * node that has not run yet renders as an empty string. `data` (Agent,
 * Value, and a Command with `output: "json"`) and `results` (a Call with
 * `each`) hold JSON and take a deeper path. A Call node's fields depend on
 * `each`, and without it the node also has the outputs of the flow it calls:
 * use `nodeOutputFields`.
 */
export const outputFieldsByType = {
	agent: agentOutputFields,
	command: commandOutputFields,
	decision: decisionOutputFields,
	call: callOutputFields,
	value: valueOutputFields,
	wait: waitOutputFields,
	tool: toolOutputFields,
	end: endOutputFields,
} as const satisfies Record<FlowNodeType, readonly string[]>;

/** Output fields that hold JSON, so a template may take a path below them. */
export const jsonOutputFields = ["data", "results"] as const;

/**
 * The fields a later node can read from `node`: `outputFieldsByType`
 * (`callEachOutputFields` for a Call with `each`), plus for a Call node
 * without `each` the output names of the flow it calls, when known.
 */
export function nodeOutputFields(
	node: FlowNode,
	called?: Flow | null,
): readonly string[] {
	if (runsEach(node)) return callEachOutputFields;
	const fields: readonly string[] = outputFieldsByType[node.type];
	if (node.type !== "call" || !called) return fields;
	const outputs = called.outputs
		.map((output) => output.name)
		.filter((name) => !fields.includes(name));
	return [...fields, ...outputs];
}
