/**
 * The flow document: the schema that puts the node types together, the
 * flow's own parts, migration of older files, and the walk from node to
 * node.
 */

export {
	DEFAULT_POLICY,
	FLOW_VERSION,
	type Flow,
	type FlowEdge,
	type FlowInput,
	type FlowInputDef,
	type FlowNode,
	type FlowNodeType,
	type FlowOutputDef,
	type FlowSection,
	type FlowVariableDef,
	flowSchema,
	flowVariableSchema,
	type Outcome,
	type Policy,
	policyFromSettings,
	type ResolvedPolicy,
	type SectionColor,
	sectionColors,
	type VariableType,
	variableTypeSchema,
} from "./flow";
export {
	migrateFlow,
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
export { QUICK_RUN_HARNESS, singleAgentFlow } from "./quick";
export {
	type NextEdge,
	type NextEdgeInput,
	nextEdge,
} from "./walk";
