import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";

/**
 * Checks an Agent's report `data` against the node's output schema (JSON
 * Schema draft 2020-12). The harness shows the schema to the model; only the
 * engine enforces it.
 */

const ajv = new Ajv2020({ allErrors: true, strict: false });
/** Compiled schemas by their JSON text: a flow's schemas rarely change. */
const compiled = new Map<string, ValidateFunction>();

function compile(schema: Record<string, unknown>): ValidateFunction {
	const key = JSON.stringify(schema);
	const known = compiled.get(key);
	if (known) return known;
	const validate = ajv.compile(schema);
	compiled.set(key, validate);
	return validate;
}

/** Null when `data` matches the schema, else what is wrong, in one line. */
export function checkOutputData(
	schema: Record<string, unknown>,
	data: unknown,
): string | null {
	let validate: ValidateFunction;
	try {
		validate = compile(schema);
	} catch (error) {
		return `The output schema of this node is not a valid JSON Schema: ${error instanceof Error ? error.message : String(error)}`;
	}
	if (data === undefined) {
		return "The agent's step report has no data, but this node has an output schema.";
	}
	if (validate(data)) return null;
	const problems = ajv.errorsText(validate.errors, {
		dataVar: "data",
		separator: "; ",
	});
	return `The agent's data does not match the output schema: ${problems}.`;
}
