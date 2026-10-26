import type {
	Flow,
	FlowNode,
	FlowVariableDef,
	VariableType,
} from "../document";
import type { JsonValue, VariableWrite } from "../nodes";
import type { TemplateContext } from "./context";
import { evaluateRule, ruleMessage } from "./rule";
import { isOnlyRef, renderValue } from "./template";

/**
 * Variables: named, typed values a flow keeps while it runs. A flow
 * declares them (`variables`), each starts from its `initial` template
 * when the flow starts, and a node changes them with `set` when its step
 * ends. Everything here is pure: the engine applies the result, checks a
 * `json` variable's schema (`checkSchema`), and logs it.
 *
 * A value comes as text (a template that is not one reference) or as a
 * value (one reference, or an expression). Text is read as the type:
 * `"3"` as a number, `"true"` as a boolean, `"[]"` as JSON. A value must be
 * of the type already. Null fits every type: the variable has no value.
 */

/** The most a variable may hold, as JSON text in UTF-8. */
export const MAX_VARIABLE_BYTES = 256 * 1024;

/** The outcomes that park a run instead of routing on: a step that ends with one writes nothing. */
const NO_WRITE_OUTCOMES = ["stopped", "error", "interrupted"];

export type Coerced =
	| { ok: true; value: JsonValue }
	| { ok: false; problem: string };

/** How a value reads in a message: JSON, cut short. */
function preview(value: JsonValue): string {
	const text = JSON.stringify(value);
	return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

const NEEDED: Record<VariableType, string> = {
	text: "text is needed",
	number: "a number is needed",
	boolean: "yes or no (true or false) is needed",
	json: "JSON is needed",
};

/** The value read as `type`, or why it does not fit. `text`: the value came as text. */
export function coerceVariable(
	type: VariableType,
	value: JsonValue,
	text: boolean,
): Coerced {
	const no = (): Coerced => ({
		ok: false,
		problem: `${NEEDED[type]}, and the value is ${preview(value)}.`,
	});
	if (value === null) return { ok: true, value: null };
	switch (type) {
		case "text":
			if (typeof value === "string") return { ok: true, value };
			if (typeof value === "number" || typeof value === "boolean") {
				return { ok: true, value: String(value) };
			}
			return no();
		case "number": {
			if (typeof value === "number") return { ok: true, value };
			if (typeof value === "string" && value.trim() !== "") {
				const number = Number(value.trim());
				if (Number.isFinite(number)) return { ok: true, value: number };
			}
			return no();
		}
		case "boolean": {
			if (typeof value === "boolean") return { ok: true, value };
			const word = typeof value === "string" ? value.trim().toLowerCase() : "";
			if (word === "true") return { ok: true, value: true };
			if (word === "false") return { ok: true, value: false };
			return no();
		}
		case "json": {
			if (!text || typeof value !== "string") return { ok: true, value };
			if (value.trim() === "") return { ok: true, value: null };
			try {
				return { ok: true, value: JSON.parse(value) as JsonValue };
			} catch {
				return {
					ok: false,
					problem: `JSON is needed, and the value is not valid JSON: ${preview(value)}.`,
				};
			}
		}
	}
}

/** Why the value is too large for a variable, or null. */
export function sizeProblem(value: JsonValue): string | null {
	const bytes = new TextEncoder().encode(JSON.stringify(value)).length;
	if (bytes <= MAX_VARIABLE_BYTES) return null;
	return `the value is ${Math.ceil(bytes / 1024)} KB, and a variable holds at most ${MAX_VARIABLE_BYTES / 1024} KB.`;
}

/** Checks a value against a JSON Schema: null when it matches, else why not. */
export type SchemaCheck = (
	schema: Record<string, unknown>,
	value: JsonValue,
) => string | null;

/** A value made for one variable: its type, its schema and its size. */
function fit(
	def: FlowVariableDef,
	value: JsonValue,
	text: boolean,
	checkSchema?: SchemaCheck,
): Coerced {
	const coerced = coerceVariable(def.type, value, text);
	if (!coerced.ok) return coerced;
	const tooLarge = sizeProblem(coerced.value);
	if (tooLarge !== null) return { ok: false, problem: tooLarge };
	if (def.schema && checkSchema && coerced.value !== null) {
		const problem = checkSchema(def.schema, coerced.value);
		if (problem !== null) {
			return { ok: false, problem: `the value does not match: ${problem}.` };
		}
	}
	return coerced;
}

const couldNotSet = (name: string, problem: string) =>
	`Could not set "${name}": ${problem}`;

export type VariableResult =
	| { ok: true; values: Record<string, JsonValue> }
	| { ok: false; error: string };

/** The values a flow starts with, and which of them an earlier run kept. */
export type InitialResult =
	| { ok: true; values: Record<string, JsonValue>; kept: string[] }
	| { ok: false; error: string };

/**
 * The flow's variables when it starts: each `initial` rendered over the
 * inputs and `run` (no node ran yet), read as its type. Unset: null. A
 * kept variable (`keep`) with a value in `kept` starts from that value
 * instead, when it still fits the type and schema: a flow edited since
 * the value was kept falls back to `initial`.
 */
export function initialVariables(
	flow: Pick<Flow, "variables">,
	context: TemplateContext,
	checkSchema?: SchemaCheck,
	kept: Readonly<Record<string, JsonValue>> = {},
): InitialResult {
	const values: Record<string, JsonValue> = {};
	const fromKept: string[] = [];
	for (const def of flow.variables ?? []) {
		if (def.keep !== undefined && Object.hasOwn(kept, def.name)) {
			const fitted = fit(def, kept[def.name] ?? null, false, checkSchema);
			if (fitted.ok) {
				values[def.name] = fitted.value;
				fromKept.push(def.name);
				continue;
			}
		}
		if (def.initial === undefined || def.initial.trim() === "") {
			values[def.name] = null;
			continue;
		}
		const value = renderValue(def.initial, context);
		const fitted = fit(def, value, !isOnlyRef(def.initial), checkSchema);
		if (!fitted.ok) {
			return { ok: false, error: couldNotSet(def.name, fitted.problem) };
		}
		values[def.name] = fitted.value;
	}
	return { ok: true, values, kept: fromKept };
}

/** Whether the write applies when the step ends with `outcome`. */
export function writesOn(write: VariableWrite, outcome: string): boolean {
	if (NO_WRITE_OUTCOMES.includes(outcome)) return false;
	return write.on === undefined || write.on.includes(outcome);
}

/**
 * The node's writes for a step that ended with `outcome`, in order: each
 * write sees the ones before it in `vars`. `context` is the step's: its
 * node's own outputs are the step's. Returns only the variables written,
 * or the first write that does not fit.
 */
export async function applyVariableWrites(input: {
	node: Pick<FlowNode, "set">;
	variables: readonly FlowVariableDef[];
	outcome: string;
	context: TemplateContext;
	checkSchema?: SchemaCheck;
}): Promise<VariableResult> {
	const written: Record<string, JsonValue> = {};
	for (const write of input.node.set ?? []) {
		if (!writesOn(write, input.outcome)) continue;
		const def = input.variables.find((v) => v.name === write.variable);
		if (!def) {
			return {
				ok: false,
				error: couldNotSet(write.variable, "the flow has no such variable."),
			};
		}
		const context: TemplateContext = {
			...input.context,
			vars: { ...input.context.vars, ...written },
		};
		let value: JsonValue;
		let text: boolean;
		if (write.expression !== undefined && write.expression.trim() !== "") {
			try {
				value = (await evaluateRule(write.expression, context)) ?? null;
			} catch (error) {
				return {
					ok: false,
					error: couldNotSet(
						def.name,
						`the expression failed: ${ruleMessage(error)}`,
					),
				};
			}
			text = false;
		} else {
			const template = write.value ?? "";
			value = renderValue(template, context);
			text = !isOnlyRef(template);
		}
		const fitted = fit(def, value, text, input.checkSchema);
		if (!fitted.ok) {
			return { ok: false, error: couldNotSet(def.name, fitted.problem) };
		}
		written[def.name] = fitted.value;
	}
	return { ok: true, values: written };
}
