/**
 * The checks of a whole flow: names, edges, loops, references and calls
 * between flows. Each node type's own checks live in `nodes/`. The
 * template scope says what a template may read, for the checks and the
 * editor's suggestions alike.
 */

export {
	parseFlow,
	validateFlow,
} from "./flow";
export type {
	FlowFile,
	FlowIssue,
	FlowListItem,
	LoadedFlow,
	ProjectFlowMap,
	ValidateOptions,
} from "./issues";
export {
	callersOf,
	canonicalFlowJson,
	type FlowPathOf,
	type FlowSource,
	type FlowSources,
	flowNameOfFile,
	listFlowSources,
	loadFlowSource,
	parsedFlows,
	scheduleFlowInfos,
	suffixedName,
} from "./sources";
export {
	calledFlow,
	schemaFields,
	type TemplateField,
	type TemplateNode,
	type TemplateScope,
	type TemplateScopeOptions,
	templateScope,
} from "./template-scope";
