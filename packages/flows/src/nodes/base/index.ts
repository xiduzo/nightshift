/** What every node type shares: JSON values, variable writes, the base fields of a node, what its check reports to, and the texts a node holds. */

export {
	holdScopeSchema,
	isObjectSchema,
	type JsonValue,
	jsonSchemaSchema,
	type NodeCheck,
	nodeBase,
	nodeBaseTexts,
	outputInferredSchema,
	type VariableWrite,
	variableWriteSchema,
} from "./base";
export {
	type HeldText,
	mapTexts,
	type NodeText,
	type TextRewrite,
	textsIn,
} from "./texts";
