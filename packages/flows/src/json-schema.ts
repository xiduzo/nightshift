import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import { FILE_FORMAT, RESERVED_DATA_KEYS } from "./shapes";

/**
 * Checks data against a JSON Schema (draft 2020-12): a node's output
 * schema, an Ask's form. One validator for every workspace, so the report
 * tool that an agent calls and the engine that ends the step judge the
 * same data the same way.
 */

const ajv = new Ajv2020({ allErrors: true, strict: false });
// A file shape (`{ "type": "string", "format": "file" }`) names a file the
// run wrote. Any string passes.
ajv.addFormat(FILE_FORMAT, true);
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

/** Null when the schema compiles, else why it is not a valid JSON Schema. */
export function schemaProblem(schema: Record<string, unknown>): string | null {
	try {
		compile(schema);
		return null;
	} catch (error) {
		return `The output schema of this node is not a valid JSON Schema: ${error instanceof Error ? error.message : String(error)}`;
	}
}

/**
 * Null when `data` matches the schema, else ajv's problems in one line
 * (`data/tests must be array`). A schema that does not compile is reported
 * the same way; check it first with `schemaProblem` when that matters.
 */
export function dataProblem(
	schema: Record<string, unknown>,
	data: unknown,
): string | null {
	let validate: ValidateFunction;
	try {
		validate = compile(schema);
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
	if (validate(data)) return null;
	return ajv.errorsText(validate.errors, { dataVar: "data", separator: "; " });
}

/**
 * Null when a step's `data` matches its node's output schema, else ajv's
 * problems in one line. The keys a node's data may hold whatever its
 * schema says (`RESERVED_DATA_KEYS`: a command's `outcome` and `scores`)
 * do not count, unless the schema names them itself.
 */
export function outputDataProblem(
	schema: Record<string, unknown>,
	data: unknown,
): string | null {
	return dataProblem(schema, withoutReservedKeys(schema, data));
}

function withoutReservedKeys(
	schema: Record<string, unknown>,
	data: unknown,
): unknown {
	if (typeof data !== "object" || data === null || Array.isArray(data)) {
		return data;
	}
	const named =
		typeof schema.properties === "object" && schema.properties !== null
			? Object.keys(schema.properties)
			: [];
	const extra = RESERVED_DATA_KEYS.filter(
		(key) => key in data && !named.includes(key),
	);
	if (extra.length === 0) return data;
	const kept: Record<string, unknown> = { ...data };
	for (const key of extra) delete kept[key];
	return kept;
}
