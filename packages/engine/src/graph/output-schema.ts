import {
	type AskForm,
	FILE_FORMAT,
	type Flow,
	type FlowNode,
	fitOutput,
	type JsonValue,
	NODE_FAMILY,
	RESERVED_DATA_KEYS,
	typedOutput,
} from "@nightshift/flows";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";

/**
 * Checks data against a node's output schema (JSON Schema draft 2020-12):
 * an Agent's report `data`, the value a Value node made, the data of a
 * Command or a Tool step. The harness or the decider shows the schema to
 * the model; only the engine enforces it (`outputVerdict`): a schema a
 * person wrote or confirmed holds the step to it, an inferred one warns.
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
 * An Agent's report `data` as the schema wants it. A model sometimes sends
 * the object as JSON text (`"{\"summary\": …}"`): when the schema does not
 * accept a string and the text is valid JSON, the parsed value is used.
 * Anything else stays as it came, for `outputVerdict` to judge.
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

/**
 * What a step's data is, in the message of a mismatch, by node type.
 * Another type says "The data of this step".
 */
const DATA_WORDS: Partial<Record<FlowNode["type"], string>> = {
	agent: "The agent's data",
	value: "The value",
	command: "The command's data",
	tool: "The tool's data",
	convert: "The converted data",
	"web-request": "The body of the answer",
};

/** Null when `data` matches the schema, else what is wrong, in one line. */
function checkData(
	schema: Record<string, unknown>,
	data: unknown,
	type: FlowNode["type"],
): string | null {
	const invalid = schemaProblem(schema);
	if (invalid !== null) return invalid;
	if (data === undefined) {
		return type === "agent"
			? "The agent's step report has no data, but this node has an output schema."
			: "The step gave no data, but this node has an output schema.";
	}
	const problems = dataProblem(schema, withoutReservedKeys(schema, data));
	if (problems === null) return null;
	return `${DATA_WORDS[type] ?? "The data of this step"} does not match the output schema: ${problems}.`;
}

/**
 * The data without the keys a node's data may hold whatever its schema
 * says (`RESERVED_DATA_KEYS`: a command's `outcome` and `scores`), unless
 * the schema names them itself.
 */
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

/**
 * What a step's data against its node's own output schema means:
 *
 * - `holds`: it matches, or the node has no schema.
 * - `warning`: it does not match a schema Night Shift inferred from an
 *   earlier run (`outputInferred`). The step goes on, and the run warns.
 * - `broken`: it does not match a schema a person wrote or confirmed.
 *   The step ends `error` for a node of the Do family (the work did not
 *   give what it promised, as an Agent always did), `fail` for a node of
 *   the Shape family (a Value, a Convert: a value that does not fit is an
 *   outcome the flow routes). A schema that is not valid ends the step
 *   `error` on any node: that is the flow's mistake.
 *
 * `data` undefined: the step gave none, which a schema does not allow.
 */
export type OutputVerdict =
	| { kind: "holds" }
	| { kind: "warning"; message: string }
	| { kind: "broken"; outcome: "error" | "fail"; message: string };

export function outputVerdict(node: FlowNode, data: unknown): OutputVerdict {
	const typed = typedOutput(node);
	if (typed === null || typed.schema === undefined) return { kind: "holds" };
	const problem = checkData(typed.schema, data, node.type);
	if (problem === null) return { kind: "holds" };
	const valid = schemaProblem(typed.schema) === null;
	if (typed.inferred && valid) {
		return { kind: "warning", message: `${problem} ${INFERRED_HINT}` };
	}
	return {
		kind: "broken",
		outcome: valid && NODE_FAMILY[node.type] === "shape" ? "fail" : "error",
		message: problem,
	};
}

/** The end of the warning of a schema Night Shift inferred. */
const INFERRED_HINT =
	"Night Shift took this shape from an earlier run. Confirm it or change it in the editor.";

/**
 * What the outputs of a called flow are against their types (Q42), as a
 * variable's value is (`fitOutput`): text is read as the type, null fits
 * every type, a `json` output is held to its `schema`.
 *
 * - `values`: the outputs the Call step gives. An output whose type a
 *   person wrote or confirmed gives its value read as that type. Any other
 *   output gives its value as it came.
 * - `warnings`: the outputs that do not fit a type Night Shift inferred
 *   from an earlier run (`inferred`), one message each. The step goes on.
 * - `broken`: the first output that does not fit a type a person wrote or
 *   confirmed, or null. The Call step ends `error` (once), the element
 *   ends `failed` (with `each`).
 */
export type FlowOutputsVerdict = {
	values: Record<string, JsonValue>;
	warnings: { output: string; message: string }[];
	broken: string | null;
};

export function flowOutputsVerdict(
	called: Pick<Flow, "outputs">,
	flowName: string,
	values: Readonly<Record<string, JsonValue>>,
): FlowOutputsVerdict {
	const verdict: FlowOutputsVerdict = {
		values: { ...values },
		warnings: [],
		broken: null,
	};
	for (const output of called.outputs ?? []) {
		if (output.type === undefined || !Object.hasOwn(values, output.name)) {
			continue;
		}
		const fitted = fitOutput(output, values[output.name] ?? null, dataProblem);
		if (fitted.ok) {
			if (!output.inferred) verdict.values[output.name] = fitted.value;
			continue;
		}
		const problem = `The output "${output.name}" of the flow "${flowName}" does not fit its type. ${capitalized(fitted.problem)}`;
		if (output.inferred) {
			verdict.warnings.push({
				output: output.name,
				message: `${problem} ${INFERRED_OUTPUT_HINT}`,
			});
		} else if (verdict.broken === null) {
			verdict.broken = problem;
		}
	}
	return verdict;
}

/** The end of the warning of a flow output type Night Shift inferred. */
const INFERRED_OUTPUT_HINT =
	"Night Shift took this type from an earlier run. Confirm it or change it in that flow.";

function capitalized(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
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
