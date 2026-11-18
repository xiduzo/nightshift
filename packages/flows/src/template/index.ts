/**
 * Templates (`{{name.path}}`), rules (JSONata) and variables: what a flow
 * reads while it runs.
 */

export {
	lookupRef,
	type NodeOutputs,
	type RunField,
	renderCommand,
	renderGateQuestion,
	renderReadable,
	renderTemplate,
	renderValue,
	runFields,
	TEMPLATE_REF,
	type TemplateContext,
	type TemplateRef,
	templateRefs,
	templatesInLiteralShellText,
} from "./refs";
export {
	acceptsValue,
	chooseByRule,
	evaluateRule,
	isTruthy,
	type RuleEvaluation,
	type RuleOutcome,
	rewriteRuleNames,
	rewriteRuleVariables,
	ruleItemRefs,
	ruleMessage,
	ruleNames,
	ruleProblem,
	ruleRefs,
	ruleVariableNames,
	signalOutcome,
} from "./rule";
export {
	applyVariableWrites,
	coerceVariable,
	fitOutput,
	initialVariables,
	type SchemaCheck,
	type VariableResult,
} from "./variables";
