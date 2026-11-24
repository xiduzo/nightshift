/** The flow schema: the node types put together, with the flow's inputs, outputs, variables, Sections, edges and run policy. */

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
	flowInputSchema,
	flowSchema,
	flowVariableSchema,
	type Outcome,
	type Policy,
	type PolicyValues,
	policyFromSettings,
	type ResolvedPolicy,
	type SectionColor,
	sectionColors,
	type VariableType,
	variableTypeSchema,
	withFlowDevices,
} from "./flow";
export { OLDER_FLOW, readFlow } from "./read-flow";
