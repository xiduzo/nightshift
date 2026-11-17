import {
	type AskForm,
	type Flow,
	type FlowNode,
	fitOutput,
	type JsonValue,
	NODE_FAMILY,
	typedOutput,
} from "@nightshift/flows";
import {
	dataProblem,
	outputDataProblem,
	schemaProblem,
} from "@nightshift/flows/json-schema";

/**
 * Checks a step's data against its node's output schema: an Agent's
 * report `data`, the value a Value node made, the data of a Command or a
 * Tool step. The check itself is `@nightshift/flows/json-schema`: the
 * report tool runs it too, so the agent can fix its data in the session.
 * Here the engine enforces it (`outputVerdict`): a schema a person wrote
 * or confirmed holds the step to it, an inferred one warns.
 */

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
	const problems = outputDataProblem(schema, data);
	if (problems === null) return null;
	return `${DATA_WORDS[type] ?? "The data of this step"} does not match the output schema: ${problems}.`;
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
