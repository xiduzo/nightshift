import type {
	Flow,
	FlowInputDef,
	JsonValue,
	TemplateContext,
} from "@nightshift/flows";
import { renderValue } from "@nightshift/flows";

import type { InputValues } from "./events";

/**
 * Binding the inputs of a flow: from the start dialog for the top-level flow
 * of a run, or from the templates of a Subflow or For Each node for a flow
 * it calls. A flow is a function; this is its argument list.
 */

export type ResolveInputsOptions = {
	/** Names the flow in errors: "The flow" or `The flow "trace"`. */
	what: string;
	/**
	 * `strict` (a person typed it): text for a `json` input must be valid
	 * JSON. `lenient` (a binding rendered it): text that is not JSON stays text.
	 */
	jsonText: "strict" | "lenient";
};

/** A value that takes the input's default: missing, null, or blank text. */
function isEmpty(value: JsonValue | undefined): boolean {
	return (
		value === undefined ||
		value === null ||
		(typeof value === "string" && value.trim() === "")
	);
}

function asText(value: JsonValue): string {
	if (typeof value === "string") return value.trim();
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	return JSON.stringify(value);
}

function parseJsonText(
	text: string,
	what: string,
): { ok: true; value: JsonValue } | { ok: false; error: string } {
	try {
		return { ok: true, value: JSON.parse(text) as JsonValue };
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return { ok: false, error: `${what} is not valid JSON: ${reason}` };
	}
}

/**
 * The flow's input values: the given value, else the default (JSON text for
 * a `json` input), else "" for `text` and null for `json`. Refuses names the
 * flow does not declare and required inputs without a value or a default.
 */
export function resolveInputs(
	declared: readonly FlowInputDef[],
	given: Readonly<Record<string, JsonValue>> | undefined,
	options: ResolveInputsOptions,
): InputValues {
	const names = new Set(declared.map((input) => input.name));
	const unknown = Object.keys(given ?? {}).filter((name) => !names.has(name));
	if (unknown.length > 0) {
		throw new Error(
			`${options.what} has no input ${unknown.map((n) => `"${n}"`).join(", ")}.`,
		);
	}
	const values: InputValues = {};
	const missing: string[] = [];
	for (const input of declared) {
		const type = input.type ?? "text";
		const value = given?.[input.name];
		const label = `The value of input "${input.name}"`;
		if (!isEmpty(value)) {
			const present = value as JsonValue;
			if (type === "text") {
				values[input.name] = asText(present);
			} else if (typeof present === "string") {
				const parsed = parseJsonText(present, label);
				if (parsed.ok) values[input.name] = parsed.value;
				else if (options.jsonText === "lenient") values[input.name] = present;
				else throw new Error(parsed.error);
			} else {
				values[input.name] = present;
			}
			continue;
		}
		if (input.default !== undefined && input.default.trim() !== "") {
			if (type === "text") {
				values[input.name] = input.default;
			} else {
				const parsed = parseJsonText(
					input.default,
					`The default of input "${input.name}"`,
				);
				if (!parsed.ok) throw new Error(parsed.error);
				values[input.name] = parsed.value;
			}
			continue;
		}
		if (input.required) missing.push(input.label ?? input.name);
		values[input.name] = type === "text" ? "" : null;
	}
	if (missing.length > 0) {
		throw new Error(
			`${options.what} needs a value for: ${missing.join(", ")}.`,
		);
	}
	return values;
}

/** Renders a node's bindings (`{ "epic": "{{epic}}" }`) to values. */
export function renderBindings(
	bindings: Readonly<Record<string, string>> | undefined,
	context: TemplateContext,
): Record<string, JsonValue> {
	const values: Record<string, JsonValue> = {};
	for (const [name, template] of Object.entries(bindings ?? {})) {
		values[name] = renderValue(template, context);
	}
	return values;
}

/** The values of a called flow's declared `outputs`, rendered in its own context. */
export function flowOutputs(
	flow: Flow,
	context: TemplateContext,
): Record<string, JsonValue> {
	const values: Record<string, JsonValue> = {};
	for (const output of flow.outputs ?? []) {
		values[output.name] = renderValue(output.value, context);
	}
	return values;
}
