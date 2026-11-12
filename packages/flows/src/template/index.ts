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
	acceptsValue,
	chooseByRule,
	evaluateRule,
	isTruthy,
	type RuleEvaluation,
	type RuleOutcome,
	ruleMessage,
	ruleNames,
	ruleProblem,
	ruleRefs,
	ruleVariableNames,
	signalOutcome,
} from "./rule";
export { templatesInLiteralShellText } from "./shell-quotes";
export {
	lookupRef,
	renderCommand,
	renderGateQuestion,
	renderReadable,
	renderTemplate,
	renderValue,
	TEMPLATE_REF,
	templateRefs,
} from "./template";
export {
	applyVariableWrites,
	coerceVariable,
	initialVariables,
	type SchemaCheck,
	type VariableResult,
} from "./variables";
