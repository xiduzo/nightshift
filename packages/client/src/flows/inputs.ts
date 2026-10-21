import type { FlowInputDef, JsonValue } from "@nightshift/flows";

/** What the person typed per input of a flow: text, or JSON text for a `json` input. */
export type InputTexts = Record<string, string>;

/** Why a JSON input's text is not valid, or null. Empty is fine: it takes the default. */
export function jsonProblem(
	input: Pick<FlowInputDef, "type">,
	text: string | undefined,
): string | null {
	if (input.type !== "json" || !text || text.trim() === "") return null;
	try {
		JSON.parse(text);
		return null;
	} catch (error) {
		return error instanceof Error ? error.message : "Not valid JSON.";
	}
}

/** Required inputs without a value and without a default. */
export function missingInputs<T extends FlowInputDef>(
	inputs: readonly T[],
	values: InputTexts,
): T[] {
	return inputs.filter(
		(input) =>
			input.required === true &&
			!input.default &&
			(values[input.name]?.trim() ?? "") === "",
	);
}

/**
 * The inputs to start a run with: text as typed (trimmed), JSON parsed,
 * only the ones filled in. An empty one takes its default. Check
 * `jsonProblem` first: JSON that is not valid throws.
 */
export function filledInputs(
	inputs: readonly FlowInputDef[],
	values: InputTexts,
): Record<string, JsonValue> {
	const filled: Record<string, JsonValue> = {};
	for (const input of inputs) {
		const text = values[input.name]?.trim() ?? "";
		if (text === "") continue;
		filled[input.name] =
			input.type === "json" ? (JSON.parse(text) as JsonValue) : text;
	}
	return filled;
}
