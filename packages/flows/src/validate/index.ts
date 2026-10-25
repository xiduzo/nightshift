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
	ValidateOptions,
} from "./issues";
export {
	schemaFields,
	type TemplateField,
	type TemplateNode,
	type TemplateScope,
	type TemplateScopeOptions,
	templateScope,
} from "./template-scope";
