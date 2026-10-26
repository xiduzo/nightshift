import type { FlowInputDef, JsonValue } from "@nightshift/flows";
import { Badge } from "@nightshift/ui/components/badge";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import { LargerTextarea } from "@/shared/larger-window";

/** What the person typed per input: text, or JSON text for a `json` input. */
export type InputTexts = Record<string, string>;

/** Why a JSON input's text does not parse, or null. Empty is fine: it takes the default. */
export function jsonProblem(
	input: FlowInputDef,
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

/**
 * The values to send: text as typed (trimmed), JSON parsed, only the ones
 * filled in. Empty takes the default.
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

/** Stored values back to the text of the fields: JSON values as pretty JSON. */
export function inputTexts(
	inputs: readonly FlowInputDef[],
	values: Readonly<Record<string, JsonValue>>,
): InputTexts {
	const texts: InputTexts = {};
	for (const input of inputs) {
		const value = values[input.name];
		if (value === undefined || value === null) continue;
		texts[input.name] =
			typeof value === "string" ? value : JSON.stringify(value, null, 2);
	}
	return texts;
}

/** Required inputs without a value or a default. */
export function missingInputs(
	inputs: readonly FlowInputDef[],
	values: InputTexts,
): FlowInputDef[] {
	return inputs.filter(
		(input) =>
			input.required &&
			!input.default &&
			(values[input.name]?.trim() ?? "") === "",
	);
}

/** One field per input of a flow: text, or JSON for a `json` input. */
export function FlowInputFields({
	idPrefix,
	inputs,
	values,
	onChange,
}: {
	idPrefix: string;
	inputs: readonly FlowInputDef[];
	values: InputTexts;
	onChange: (values: InputTexts) => void;
}) {
	if (inputs.length === 0) return null;
	return (
		<FieldSet className="gap-4">
			<FieldLegend variant="label" className="sr-only">
				Inputs
			</FieldLegend>
			<FieldGroup className="gap-5">
				{inputs.map((input) => {
					const fieldId = `${idPrefix}-input-${input.name}`;
					const value = values[input.name] ?? "";
					const problem = jsonProblem(input, value);
					const hint = problem
						? `Not valid JSON: ${problem}`
						: input.description;
					const set = (next: string) =>
						onChange({ ...values, [input.name]: next });
					return (
						<Field
							key={input.name}
							data-invalid={problem !== null || undefined}
						>
							<FieldLabel htmlFor={fieldId}>
								{input.label || input.name}
								{input.type === "json" ? (
									<Badge variant="secondary" className="font-mono font-normal">
										json
									</Badge>
								) : null}
								{input.required ? (
									<span className="font-normal text-muted-foreground">
										(required)
									</span>
								) : null}
							</FieldLabel>
							{input.type === "json" ? (
								<LargerTextarea
									title={input.label || input.name}
									id={fieldId}
									value={value}
									placeholder={input.default ?? '{"title": "…"}'}
									className="max-h-60 min-h-20 font-mono text-xs md:text-xs"
									spellCheck={false}
									aria-required={input.required === true}
									aria-invalid={problem !== null}
									aria-describedby={hint ? `${fieldId}-hint` : undefined}
									onChange={(event) => set(event.target.value)}
								/>
							) : (
								<Input
									id={fieldId}
									value={value}
									placeholder={input.default}
									autoComplete="off"
									aria-required={input.required === true}
									aria-describedby={hint ? `${fieldId}-hint` : undefined}
									onChange={(event) => set(event.target.value)}
								/>
							)}
							{problem ? (
								<FieldError id={`${fieldId}-hint`}>{hint}</FieldError>
							) : hint ? (
								<FieldDescription id={`${fieldId}-hint`}>
									{hint}
								</FieldDescription>
							) : null}
						</Field>
					);
				})}
			</FieldGroup>
		</FieldSet>
	);
}
