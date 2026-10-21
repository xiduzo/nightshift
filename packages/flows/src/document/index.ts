/**
 * The flow document: the schema that puts the node types together, the
 * flow's own parts, migration of older files, and the walk from node to
 * node.
 */

export {
	FLOW_VERSION,
	type Flow,
	type FlowEdge,
	type FlowInput,
	type FlowInputDef,
	type FlowNode,
	type FlowNodeType,
	type FlowOutputDef,
	type FlowVariableDef,
	flowEdgeSchema,
	flowInputSchema,
	flowNodeSchema,
	flowOutputSchema,
	flowSchema,
	flowVariableSchema,
	type Outcome,
	outcomeSchema,
	type Policy,
	policySchema,
	type ResolvedPolicy,
	type VariableType,
	variableTypeSchema,
} from "./flow";
export {
	migrateCallNodes,
	migrateDecider,
	migrateDecisionNodes,
	migrateFlow,
	migrateListSource,
	migrateToolSets,
} from "./migrate";
export {
	jsonOutputFields,
	nodeOutcomes,
	nodeOutputFields,
	outcomeColor,
	outputFieldsByType,
	runsEach,
} from "./node";
export { singleAgentFlow } from "./quick";
export {
	type NextEdge,
	type NextEdgeInput,
	nextEdge,
} from "./walk";
