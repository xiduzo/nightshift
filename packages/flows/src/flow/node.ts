import {
	agentDefinition,
	type CallEachNode,
	callDefinition,
	callEachOutputFields,
	cascadeOutputFields,
	commandDefinition,
	confidenceField,
	convertDefinition,
	type DecidedBy,
	decisionDefinition,
	endDefinition,
	joinDefinition,
	leaseDefinition,
	type NodeDefinition,
	type NodeFamily,
	type OutcomeColor,
	serviceDefinition,
	sinceLastRunDefinition,
	toolDefinition,
	valueDefinition,
	waitDefinition,
	webRequestDefinition,
} from "../nodes";
import type { Flow, FlowInput, FlowNode, FlowNodeType, Outcome } from "./flow";

/**
 * The node types of the flow schema, each with its definition: every fact
 * of the type that holds without a run (`NodeDefinition`, one per file in
 * `nodes/`). The facts of a node read its type's definition here, so a
 * new type is its file and one line in this list. A type of the schema
 * without a definition, or a definition of no type, does not compile.
 */
export const NODE_DEFINITIONS = {
	agent: agentDefinition,
	command: commandDefinition,
	decision: decisionDefinition,
	call: callDefinition,
	value: valueDefinition,
	wait: waitDefinition,
	tool: toolDefinition,
	end: endDefinition,
	join: joinDefinition,
	lease: leaseDefinition,
	service: serviceDefinition,
	"since-last-run": sinceLastRunDefinition,
	convert: convertDefinition,
	"web-request": webRequestDefinition,
} as const satisfies {
	readonly [T in FlowNodeType]: NodeDefinition<
		Extract<FlowNode, { type: T }>,
		Extract<NodeInput, { type: T }>
	>;
};

/** A node as a flow file holds it, before defaults apply. */
type NodeInput = FlowInput["nodes"][number];

/**
 * The definition of a node's type, typed for any flow node. The list is
 * typed per type. A caller that holds a `FlowNode` gets this erased view
 * and passes that same node, so the cast holds.
 */
export function definitionOf(node: Pick<FlowNode, "type">) {
	return NODE_DEFINITIONS[node.type] as unknown as NodeDefinition<
		FlowNode,
		NodeInput
	>;
}

const NODE_TYPES = Object.keys(NODE_DEFINITIONS) as FlowNodeType[];

/** One fact of every node type, by its type. */
function byType<V>(fact: (type: FlowNodeType) => V): {
	readonly [T in FlowNodeType]: V;
} {
	return Object.fromEntries(NODE_TYPES.map((type) => [type, fact(type)])) as {
		readonly [T in FlowNodeType]: V;
	};
}

/** What a person calls each node type, on every screen (`NodeDefinition.label`). */
export const NODE_TYPE_LABEL = byType((type) => NODE_DEFINITIONS[type].label);

/** The family of each node type (`NodeDefinition.family`). */
export const NODE_FAMILY: { readonly [T in FlowNodeType]: NodeFamily } = byType(
	(type) => NODE_DEFINITIONS[type].family,
);

/**
 * What a person calls a Decision, by who decides it. You decide a Gate, a
 * rule decides a Branch. A Decision by a model keeps the plain name.
 */
export const DECISION_LABEL = {
	person: "Gate",
	rule: "Branch",
	model: "Decision",
} as const satisfies Record<DecidedBy, string>;

/** Whether the node is a Call node that runs its flow once per element. */
export function runsEach(node: FlowNode): node is CallEachNode {
	return node.type === "call" && node.each !== undefined;
}

/** The outcomes a node can end with, in the order its handles show. */
export function nodeOutcomes(node: FlowNode): readonly Outcome[] {
	return definitionOf(node).outcomes(node);
}

/** Whether a test run may pin or skip a node of this type (ADR 27). */
export function standsIn(node: Pick<FlowNode, "type">): boolean {
	return definitionOf(node).standsIn;
}

/**
 * The outcomes a node may give in a test run, pinned or skipped: its own
 * (`nodeOutcomes`). Not `stopped`, which a Call can end with: a stand-in
 * that ends `stopped` would stop the run.
 */
export function standInOutcomes(node: FlowNode): readonly Outcome[] {
	return nodeOutcomes(node).filter((outcome) => outcome !== "stopped");
}

/** The colour a node gives one of its outcomes, or undefined when it sets none. */
export function outcomeColor(
	node: FlowNode,
	outcome: Outcome,
): OutcomeColor | undefined {
	return definitionOf(node).outcomeColor(node, outcome);
}

/**
 * The fields a later node can read with `{{<nodeId>.<field>}}`, by type
 * (`NodeDefinition.outputFields`). A field of a node that has not run yet
 * renders as an empty string. `data` (Agent, Value, and a Command with
 * `stdout: "json"`) and `results` (a Call with `each`) hold JSON and take a
 * deeper path. A Call node's fields depend on `each`, and without it the
 * node also has the outputs of the flow it calls: use `nodeOutputFields`.
 */
export const outputFieldsByType = byType(
	(type) => NODE_DEFINITIONS[type].outputFields,
) as {
	readonly [T in FlowNodeType]: (typeof NODE_DEFINITIONS)[T]["outputFields"];
};

/**
 * Output fields that hold JSON, so a template may take a path below them.
 * A Join's `data` holds one entry per branch. A Web request's `headers`
 * and `body` hold its answer.
 */
export const jsonOutputFields = ["data", "results", "headers", "body"] as const;

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
	const fields: readonly string[] = [
		...definitionOf(node).outputFields,
		...cascadeFieldsOf(node),
	];
	if (node.type !== "call" || !called) return fields;
	const outputs = called.outputs
		.map((output) => output.name)
		.filter((name) => !fields.includes(name));
	return [...fields, ...outputs];
}

/**
 * The fields a cascade adds to a node's step (ADR 6): the tier that held
 * and the tries, and for a Decision the probability of its pick.
 */
function cascadeFieldsOf(node: FlowNode): readonly string[] {
	if (!("cascade" in node) || node.cascade === undefined) return [];
	return node.type === "decision"
		? [...cascadeOutputFields, confidenceField]
		: cascadeOutputFields;
}
