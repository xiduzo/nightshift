/**
 * Shapes: what an output field, an input, a variable or a flow output
 * holds, as JSON Schema, and the editor's model of it (text, number, yes
 * or no, choice, file, list, record). The checks of a flow read a
 * template's path into these shapes.
 */

export { schemaAt } from "./at";
export { FEED_ITEM_KEYS, FEED_ITEM_SHAPE } from "./convert";
export {
	inputShape,
	mainOutputField,
	outputFieldShape,
	RESERVED_DATA_KEYS,
	typedOutput,
	variableShape,
} from "./fields";
export { inferOutputType, inferSchema } from "./infer";
export {
	emptyShape,
	FILE_FORMAT,
	fieldNameProblem,
	fromJsonSchema,
	type SchemaField,
	type SchemaShape,
	SHAPE_KINDS,
	type ShapeKind,
	shapeIsValid,
	toJsonSchema,
} from "./shape";
