import type { FlowInputDef, JsonValue } from "@nightshift/flows";

/**
 * What the person entered per input of a flow, as text: JSON text for a
 * `json` input, `true` or `false` for a `boolean` one.
 */
export type InputTexts = Record<string, string>;

/**
 * Why the text of a `json` or `number` input is not valid, as a message
 * for the person, or null. Empty is fine: it takes the default.
 */
export function inputProblem(
	input: Pick<FlowInputDef, "type">,
	text: string | undefined,
): string | null {
	if (!text || text.trim() === "") return null;
	if (input.type === "number") {
		return Number.isFinite(Number(text.trim()))
			? null
			: "Enter a number, for example 45.";
	}
	if (input.type !== "json") return null;
	try {
		JSON.parse(text);
		return null;
	} catch (error) {
		const reason = error instanceof Error ? error.message : "";
		return `Not valid JSON. ${reason}`.trim();
	}
}

/**
 * Whether the person may leave the input empty: it is not required, or it
 * has a default. A `boolean` input always has a value.
 */
export function isOptional(
	input: Pick<FlowInputDef, "type" | "required" | "default">,
): boolean {
	return (
		input.type !== "boolean" && (input.required !== true || !!input.default)
	);
}

/** Required inputs without a value and without a default. */
export function missingInputs<T extends FlowInputDef>(
	inputs: readonly T[],
	values: InputTexts,
): T[] {
	return inputs.filter(
		(input) =>
			input.type !== "boolean" &&
			input.required === true &&
			!input.default &&
			(values[input.name]?.trim() ?? "") === "",
	);
}

/**
 * The inputs to start a run with, only the ones filled in: text as typed
 * (trimmed), a number, true or false, or parsed JSON. An empty one takes
 * its default. Check `inputProblem` first: JSON that is not valid throws.
 */
export function filledInputs(
	inputs: readonly FlowInputDef[],
	values: InputTexts,
): Record<string, JsonValue> {
	const filled: Record<string, JsonValue> = {};
	for (const input of inputs) {
		const text = values[input.name]?.trim() ?? "";
		if (text === "") continue;
		switch (input.type) {
			case "json":
				filled[input.name] = JSON.parse(text) as JsonValue;
				break;
			case "number":
				filled[input.name] = Number(text);
				break;
			case "boolean":
				filled[input.name] = text === "true";
				break;
			default:
				filled[input.name] = text;
		}
	}
	return filled;
}
