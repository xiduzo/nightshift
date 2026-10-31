import {
	type AskOption,
	type AskValue,
	type AskValues,
	askAnswerOf,
	askFormFields,
	askOptions,
	askStartValues,
	deadlineText,
} from "@nightshift/client";
import type { AskField, AskForm as Form } from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import { Checkbox } from "@nightshift/ui/components/checkbox";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
	FieldTitle,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import {
	RadioGroup,
	RadioGroupItem,
} from "@nightshift/ui/components/radio-group";
import { Spinner } from "@nightshift/ui/components/spinner";
import { Switch } from "@nightshift/ui/components/switch";
import { Textarea } from "@nightshift/ui/components/textarea";
import { cn } from "@nightshift/ui/lib/utils";
import { AlarmClockIcon } from "lucide-react";
import { useId, useState } from "react";
import { AskAttachments } from "./ask-attachments";
import { useResolveGate } from "./use-resolve-gate";

/**
 * Answers an Ask (ADR 10): a form drawn from the node's output schema. A
 * string is a text field, an enum a choice, an array of enum a choice of
 * several, a boolean a switch, a number a number field, and any other
 * field takes JSON. The run's choices show their labels, descriptions and
 * files. The form starts with the best answer of the models, if there is
 * one. Nothing goes out before the send, and Night Shift checks the
 * answer again.
 */
export function AskForm({
	runId,
	stepId,
	form,
	deadline,
	runTitle,
	walkerName,
	filesHere,
	className,
}: {
	runId: string;
	stepId: string;
	form: Form;
	deadline: { at: number; choose: string } | null;
	runTitle?: string;
	/** The device that runs the run, when it is not this computer: the answer goes to it. */
	walkerName?: string;
	/** The run's files are on this computer, so its images show. */
	filesHere: boolean;
	className?: string;
}) {
	const id = useId();
	const [values, setValues] = useState<AskValues>(() => askStartValues(form));
	const [tried, setTried] = useState(false);
	const resolve = useResolveGate({
		...(runTitle ? { runTitle } : {}),
		...(walkerName ? { walkerName } : {}),
	});
	const answer = askAnswerOf(form, values);
	const set = (name: string, value: AskValue) =>
		setValues((current) => ({ ...current, [name]: value }));

	const send = () => {
		setTried(true);
		if (resolve.isPending || "problem" in answer) return;
		resolve.mutate({
			runId,
			stepId,
			choice: "answer",
			data: answer.data,
		});
	};

	return (
		<form
			className={cn("flex flex-col gap-5", className)}
			onSubmit={(event) => {
				event.preventDefault();
				send();
			}}
		>
			<FieldGroup className="gap-5">
				{askFormFields(form).map((field) => (
					<AskFieldInput
						key={field.name}
						id={`${id}-${field.name}`}
						runId={runId}
						form={form}
						field={field}
						value={values[field.name]}
						disabled={resolve.isPending}
						filesHere={filesHere}
						onChange={(value) => set(field.name, value)}
					/>
				))}
			</FieldGroup>
			{deadline ? (
				<p className="flex items-start gap-1.5 text-muted-foreground text-xs leading-snug">
					<AlarmClockIcon
						className="mt-px size-3.5 shrink-0"
						aria-hidden="true"
					/>
					{deadlineText(deadline, Date.now(), form)}
				</p>
			) : null}
			{tried && "problem" in answer ? (
				<FieldError>{answer.problem}</FieldError>
			) : null}
			<Button type="submit" disabled={resolve.isPending}>
				{resolve.isPending ? <Spinner data-icon="inline-start" /> : null}
				Send answer
			</Button>
		</form>
	);
}

/** One field of the form, drawn by its kind. */
function AskFieldInput({
	id,
	runId,
	form,
	field,
	value,
	disabled,
	filesHere,
	onChange,
}: {
	id: string;
	runId: string;
	form: Form;
	field: AskField;
	value: AskValue | undefined;
	disabled: boolean;
	filesHere: boolean;
	onChange: (value: AskValue) => void;
}) {
	const hint = field.hint ? (
		<FieldDescription id={`${id}-hint`} className="text-xs">
			{field.hint}
		</FieldDescription>
	) : null;
	const label = (
		<>
			{field.label}
			{field.required ? null : (
				<span className="font-normal text-muted-foreground">(optional)</span>
			)}
		</>
	);
	const described = field.hint ? `${id}-hint` : undefined;
	switch (field.kind) {
		case "switch":
			return (
				<Field orientation="horizontal">
					<FieldContent>
						<FieldLabel htmlFor={id}>{field.label}</FieldLabel>
						{hint}
					</FieldContent>
					<Switch
						id={id}
						checked={value === true}
						disabled={disabled}
						onCheckedChange={(checked) => onChange(checked)}
						aria-describedby={described}
					/>
				</Field>
			);
		case "choice":
			return (
				<FieldSet className="gap-2">
					<FieldLegend variant="label">{label}</FieldLegend>
					{hint}
					<RadioGroup
						value={typeof value === "string" && value !== "" ? value : null}
						onValueChange={(next) => onChange(next as string)}
						disabled={disabled}
						className="grid gap-2"
					>
						{askOptions(form, field).map((option) => (
							<OptionCard
								key={option.name}
								id={`${id}-${option.name}`}
								runId={runId}
								option={option}
								filesHere={filesHere}
								control={
									<RadioGroupItem
										value={option.name}
										id={`${id}-${option.name}`}
									/>
								}
							/>
						))}
					</RadioGroup>
				</FieldSet>
			);
		case "choices": {
			const picked = Array.isArray(value) ? value : [];
			return (
				<FieldSet className="gap-2">
					<FieldLegend variant="label">{label}</FieldLegend>
					{hint}
					<div className="grid gap-2">
						{askOptions(form, field).map((option) => (
							<OptionCard
								key={option.name}
								id={`${id}-${option.name}`}
								runId={runId}
								option={option}
								filesHere={filesHere}
								control={
									<Checkbox
										id={`${id}-${option.name}`}
										checked={picked.includes(option.name)}
										disabled={disabled}
										onCheckedChange={(checked) =>
											onChange(
												checked
													? [...picked, option.name]
													: picked.filter((name) => name !== option.name),
											)
										}
									/>
								}
							/>
						))}
					</div>
				</FieldSet>
			);
		}
		case "number":
			return (
				<Field className="gap-2">
					<FieldLabel htmlFor={id}>{label}</FieldLabel>
					<Input
						id={id}
						type="number"
						inputMode={field.integer ? "numeric" : "decimal"}
						step={field.integer ? 1 : "any"}
						value={typeof value === "string" ? value : ""}
						disabled={disabled}
						onChange={(event) => onChange(event.target.value)}
						aria-describedby={described}
					/>
					{hint}
				</Field>
			);
		default:
			return (
				<Field className="gap-2">
					<FieldLabel htmlFor={id}>{label}</FieldLabel>
					<Textarea
						id={id}
						rows={field.kind === "other" ? 4 : 2}
						value={typeof value === "string" ? value : ""}
						disabled={disabled}
						placeholder={field.kind === "other" ? '{ "key": "value" }' : ""}
						className={cn(
							"max-h-60 text-sm md:text-sm",
							field.kind === "other" && "font-mono text-xs md:text-xs",
						)}
						onChange={(event) => onChange(event.target.value)}
						aria-describedby={described}
					/>
					{hint}
				</Field>
			);
	}
}

/** One option of a choice: its label, description and files, with its radio or checkbox. */
function OptionCard({
	id,
	runId,
	option,
	filesHere,
	control,
}: {
	id: string;
	runId: string;
	option: AskOption;
	filesHere: boolean;
	control: React.ReactNode;
}) {
	return (
		<FieldLabel htmlFor={id}>
			<Field orientation="horizontal">
				<FieldContent className="min-w-0">
					<FieldTitle>{option.label}</FieldTitle>
					{option.description ? (
						<FieldDescription className="whitespace-pre-wrap text-xs">
							{option.description}
						</FieldDescription>
					) : null}
					{option.attachments && option.attachments.length > 0 ? (
						<AskAttachments
							runId={runId}
							attachments={option.attachments}
							filesHere={filesHere}
							className="mt-1"
						/>
					) : null}
				</FieldContent>
				{control}
			</Field>
		</FieldLabel>
	);
}
