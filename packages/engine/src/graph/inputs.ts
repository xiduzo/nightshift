import {
	type Flow,
	type FlowInputDef,
	type JsonValue,
	renderValue,
	type TemplateContext,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";

import type { InputValues } from "../log";

/**
 * Binding the inputs of a flow: from the start dialog for the top-level flow
 * of a run, or from the templates of a Call node for a flow
 * it calls. A flow is a function; this is its argument list.
 */

export type ResolveInputsOptions = {
	/** Names the flow in errors: "The flow" or `The flow "trace"`. */
	what: string;
	/**
	 * `strict` (a person typed it): a value must fit the input's type.
	 * `lenient` (a binding rendered it): a value that does not fit stays as it came.
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

/** Text read as true or false: `true`, `yes`, `on`, `1` and their opposites. */
const BOOLEAN_TEXT: Record<string, boolean> = {
	true: true,
	yes: true,
	on: true,
	"1": true,
	false: false,
	no: false,
	off: false,
	"0": false,
};

type Read = { ok: true; value: JsonValue } | { ok: false; error: string };

/**
 * A given value or a default, read as the input's type. `what` names the
 * value in errors. Text that a `json` input cannot parse is an error here:
 * the caller decides whether lenient text stays.
 */
function readValue(input: FlowInputDef, value: JsonValue, what: string): Read {
	switch (input.type ?? "text") {
		case "text":
			return { ok: true, value: asText(value) };
		case "number": {
			const number = typeof value === "number" ? value : Number(asText(value));
			if (Number.isFinite(number)) return { ok: true, value: number };
			return { ok: false, error: `${what} is not a number.` };
		}
		case "boolean": {
			if (typeof value === "boolean") return { ok: true, value };
			const read = BOOLEAN_TEXT[asText(value).toLowerCase()];
			if (read !== undefined) return { ok: true, value: read };
			return { ok: false, error: `${what} is not true or false.` };
		}
		case "choice": {
			const text = asText(value);
			const options = input.options ?? [];
			if (options.length === 0 || options.includes(text)) {
				return { ok: true, value: text };
			}
			return {
				ok: false,
				error: `${what} is not one of: ${options.join(", ")}.`,
			};
		}
		case "json":
			return typeof value === "string"
				? parseJsonText(value, what)
				: { ok: true, value };
	}
}

/** The value of an input without a value or a default. */
function emptyValue(input: FlowInputDef): JsonValue {
	switch (input.type ?? "text") {
		case "text":
		case "choice":
			return "";
		case "boolean":
			return false;
		default:
			return null;
	}
}

/**
 * The flow's input values: the given value, else the default, each read as
 * the input's type. Without either: "" for `text` and `choice`, false for
 * `boolean`, null for `number` and `json`. Refuses names the flow does not
 * declare, values that do not fit the type, and required inputs without a
 * value or a default. Each refusal is `invalid`.
 */
export function resolveInputs(
	declared: readonly FlowInputDef[],
	given: Readonly<Record<string, JsonValue>> | undefined,
	options: ResolveInputsOptions,
): InputValues {
	const names = new Set(declared.map((input) => input.name));
	const unknown = Object.keys(given ?? {}).filter((name) => !names.has(name));
	if (unknown.length > 0) {
		throw new Refusal(
			"invalid",
			`${options.what} has no input ${unknown.map((n) => `"${n}"`).join(", ")}.`,
		);
	}
	const values: InputValues = {};
	const missing: string[] = [];
	for (const input of declared) {
		const value = given?.[input.name];
		if (!isEmpty(value)) {
			const present = value as JsonValue;
			const read = readValue(
				input,
				present,
				`The value of input "${input.name}"`,
			);
			if (read.ok) values[input.name] = read.value;
			// A binding renders text: what does not fit the type stays as it came.
			else if (options.jsonText === "lenient") values[input.name] = present;
			else throw new Refusal("invalid", read.error);
			continue;
		}
		if (input.default !== undefined && input.default.trim() !== "") {
			// Text keeps the default as written.
			if ((input.type ?? "text") === "text") {
				values[input.name] = input.default;
				continue;
			}
			const read = readValue(
				input,
				input.default.trim(),
				`The default of input "${input.name}"`,
			);
			if (!read.ok) throw new Refusal("invalid", read.error);
			values[input.name] = read.value;
			continue;
		}
		if (input.required) missing.push(input.label ?? input.name);
		values[input.name] = emptyValue(input);
	}
	if (missing.length > 0) {
		throw new Refusal(
			"invalid",
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
