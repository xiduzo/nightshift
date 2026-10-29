import {
	agentOutputFields,
	type CallEachNode,
	callEachOutputFields,
	callOutputFields,
	commandExits,
	commandOutputFields,
	type DecidedBy,
	decisionOutputFields,
	endOutputFields,
	joinOutputFields,
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

/**
 * What a person calls each node type, on every screen: a Call node is a
 * Subflow. A Decision has a name of its own by who decides it:
 * `DECISION_LABEL`.
 */
export const NODE_TYPE_LABEL = {
	agent: "Agent",
	command: "Command",
	decision: "Decision",
	call: "Subflow",
	value: "Value",
	wait: "Wait",
	tool: "Tool",
	end: "End",
	join: "Join",
} as const satisfies Record<FlowNodeType, string>;

/**
 * What a person calls a Decision, by who decides it. You decide a Gate, a
 * rule decides a Branch. A Decision by a model keeps the plain name.
 */
export const DECISION_LABEL = {
	person: "Gate",
	rule: "Branch",
	model: "Decision",
} as const satisfies Record<DecidedBy, string>;

/**
 * The outcomes Night Shift names itself: the ones a node ends on when the
 * flow names none (`nodeOutcomes`), and the ones the engine ends a step on
 * when its work did not finish (`error`, `stopped`, `interrupted`). Any
 * other outcome is a name the flow gives: an agent outcome, a command exit,
 * a Decision option. Each screen gives these a word of their own.
 */
export type BuiltInOutcome =
	| "pass"
	| "fail"
	| "needs-input"
	| "done"
	| "halted"
	| "timeout"
	| "error"
	| "stopped"
	| "interrupted";

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
				: (["pass", "fail", "needs-input"] satisfies BuiltInOutcome[]);
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
				? (["done", "halted", "stopped"] satisfies BuiltInOutcome[])
				: (["pass", "fail", "stopped"] satisfies BuiltInOutcome[]);
		case "value":
			return ["pass", "fail"] satisfies BuiltInOutcome[];
		case "wait":
			return ["done", "timeout"] satisfies BuiltInOutcome[];
		case "tool":
			return ["pass", "fail"] satisfies BuiltInOutcome[];
		case "end":
			// No edge leaves an End node: the run ends there.
			return [];
		case "join":
			return ["done"] satisfies BuiltInOutcome[];
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
	join: joinOutputFields,
} as const satisfies Record<FlowNodeType, readonly string[]>;

/** Output fields that hold JSON, so a template may take a path below them. A Join's `data` holds one entry per branch. */
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
