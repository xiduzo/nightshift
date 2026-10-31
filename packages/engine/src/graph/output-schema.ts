import type { AskForm } from "@nightshift/flows";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";

/**
 * Checks data against a node's output schema (JSON Schema draft 2020-12):
 * an Agent's report `data`, or the value a Value node made. The harness or
 * the decider shows the schema to the model; only the engine enforces it.
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
 * An Agent's report `data` as the schema wants it. A model sometimes sends
 * the object as JSON text (`"{\"summary\": …}"`): when the schema does not
 * accept a string and the text is valid JSON, the parsed value is used.
 * Anything else stays as it came, for `checkOutputData` to judge.
 */
export function normalizeOutputData(
	schema: Record<string, unknown>,
	data: unknown,
): unknown {
	if (typeof data !== "string" || dataProblem(schema, data) === null) {
		return data;
	}
	try {
		return JSON.parse(data);
	} catch {
		return data;
	}
}

/** Null when an Agent's report `data` matches the schema, else what is wrong, in one line. */
export function checkOutputData(
	schema: Record<string, unknown>,
	data: unknown,
): string | null {
	const invalid = schemaProblem(schema);
	if (invalid !== null) return invalid;
	if (data === undefined) {
		return "The agent's step report has no data, but this node has an output schema.";
	}
	const problems = dataProblem(schema, data);
	if (problems === null) return null;
	return `The agent's data does not match the output schema: ${problems}.`;
}

/**
 * Null when `data` answers the Ask (ADR 10): it matches the form's schema
 * (the node's output, with the run's choices as the `enum` of their
 * field). Else what is wrong, for the person who answered.
 */
export function askAnswerProblem(form: AskForm, data: unknown): string | null {
	if (data === undefined) return "Fill in the form to answer.";
	const problems = dataProblem(form.schema, data);
	return problems === null
		? null
		: `The answer does not match the form: ${problems}.`;
}
