/** The definition of a node type (`NodeDefinition`), the families, and the outcomes a node lists itself. */

export {
	type BuiltInOutcome,
	EXAMPLE_DEVICE,
	endsOnPass,
	type NewNode,
	NODE_FAMILIES,
	NODE_FAMILY_LABEL,
	type NodeDefaults,
	type NodeDefinition,
	type NodeFamily,
	noEndedLabel,
	noOwnColors,
	noSecrets,
	type Position,
	takesNoValue,
} from "./definition";
export {
	checkOptions,
	decisionOption,
	type Option,
	type OutcomeColor,
	option,
	optionProblem,
	outcomeColorSchema,
	outcomeColors,
} from "./outcomes";
