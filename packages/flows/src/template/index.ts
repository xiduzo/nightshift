/**
 * Templates (`{{name.path}}`), rules (JSONata) and variables: what a flow
 * reads while it runs.
 */

export {
	type NodeOutputs,
	type RunField,
	runFields,
	type TemplateContext,
	type TemplateRef,
} from "./context";
export {
	chooseByRule,
	evaluateRule,
	isTruthy,
	type RuleEvaluation,
	type RuleOutcome,
	ruleContext,
	ruleMessage,
	ruleNames,
	ruleProblem,
	ruleVariableNames,
} from "./rule";
export {
	isOnlyRef,
	lookupRef,
	renderCommand,
	renderTemplate,
	renderValue,
	templateEnvName,
	templateRefs,
} from "./template";
export {
	applyVariableWrites,
	type Coerced,
	coerceVariable,
	initialVariables,
	MAX_VARIABLE_BYTES,
	type SchemaCheck,
	sizeProblem,
	type VariableResult,
	writesOn,
} from "./variables";
