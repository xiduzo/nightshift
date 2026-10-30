import { type InputTexts, inputProblem, isOptional } from "@nightshift/client";
import type { FlowInputDef } from "@nightshift/flows";
import { Badge } from "@nightshift/ui/components/badge";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@nightshift/ui/components/select";
import { Switch } from "@nightshift/ui/components/switch";
import { LargerTextarea } from "@/shared/larger-window";

/** The label of an input, with "(optional)" when it may stay empty. */
function InputLabel({
	htmlFor,
	input,
}: {
	htmlFor: string;
	input: FlowInputDef;
}) {
	return (
		<FieldLabel htmlFor={htmlFor}>
			{input.label || input.name}
			{input.type === "json" ? (
				<Badge variant="secondary" className="font-mono font-normal">
					json
				</Badge>
			) : null}
			{isOptional(input) ? (
				<span className="font-normal text-muted-foreground">(optional)</span>
			) : null}
		</FieldLabel>
	);
}

/**
 * One field per input of a flow, by its type: a text field, a number
 * field, a switch, a list to pick from, or JSON. With `templates`, a
 * text, number or JSON value may read a webhook (`{{event.body.number}}`):
 * it is read when the webhook arrives, not here.
 */
export function FlowInputFields({
	idPrefix,
	inputs,
	values,
	onChange,
	templates = false,
}: {
	idPrefix: string;
	inputs: readonly FlowInputDef[];
	values: InputTexts;
	onChange: (values: InputTexts) => void;
	templates?: boolean;
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
					const hintId = `${fieldId}-hint`;
					const value = values[input.name] ?? "";
					const problem =
						templates && value.includes("{{")
							? null
							: inputProblem(input, value);
					const hint = problem ?? input.description;
					const set = (next: string) =>
						onChange({ ...values, [input.name]: next });
					const hintText = problem ? (
						<FieldError id={hintId}>{hint}</FieldError>
					) : hint ? (
						<FieldDescription id={hintId}>{hint}</FieldDescription>
					) : null;

					if (input.type === "boolean") {
						return (
							<Field
								key={input.name}
								orientation="horizontal"
								className="items-start"
							>
								<Switch
									id={fieldId}
									checked={(value || input.default) === "true"}
									className="mt-0.5"
									aria-describedby={hint ? hintId : undefined}
									onCheckedChange={(on) => set(on ? "true" : "false")}
								/>
								<FieldContent>
									<InputLabel htmlFor={fieldId} input={input} />
									{hintText}
								</FieldContent>
							</Field>
						);
					}

					// An optional choice without a default can stay empty.
					const none = isOptional(input) && !input.default;
					return (
						<Field
							key={input.name}
							data-invalid={problem !== null || undefined}
						>
							<InputLabel htmlFor={fieldId} input={input} />
							{input.type === "choice" ? (
								<Select
									items={[
										...(none ? [{ value: null, label: "None" }] : []),
										...(input.options ?? []).map((option) => ({
											value: option,
											label: option,
										})),
									]}
									value={value === "" ? null : value}
									onValueChange={(next) => set(next ?? "")}
								>
									<SelectTrigger
										id={fieldId}
										className="w-full"
										aria-describedby={hint ? hintId : undefined}
									>
										<SelectValue placeholder={input.default ?? "None"} />
									</SelectTrigger>
									<SelectContent>
										{none ? <SelectItem value={null}>None</SelectItem> : null}
										{(input.options ?? []).map((option) => (
											<SelectItem key={option} value={option}>
												{option}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							) : input.type === "json" ? (
								<LargerTextarea
									title={input.label || input.name}
									id={fieldId}
									value={value}
									placeholder={input.default ?? '{"title": "…"}'}
									className="max-h-60 min-h-20 font-mono text-xs md:text-xs"
									spellCheck={false}
									aria-required={!isOptional(input)}
									aria-invalid={problem !== null}
									aria-describedby={hint ? hintId : undefined}
									onChange={(event) => set(event.target.value)}
								/>
							) : (
								<Input
									id={fieldId}
									value={value}
									placeholder={input.default}
									autoComplete="off"
									inputMode={input.type === "number" ? "decimal" : undefined}
									aria-required={!isOptional(input)}
									aria-invalid={problem !== null}
									aria-describedby={hint ? hintId : undefined}
									onChange={(event) => set(event.target.value)}
								/>
							)}
							{hintText}
						</Field>
					);
				})}
			</FieldGroup>
		</FieldSet>
	);
}
