/** The fields of an Ask (a Value made by a person): choices from the run, files and links, and a deadline with a default. */
import {
	type AskDeadline,
	type AttachmentSource,
	askFields,
	choicesFieldProblem,
	type Flow,
	type JsonValue,
	type ValueNode,
} from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import {
	FieldContent,
	FieldDescription,
	FieldLabel,
	Field as ShadcnField,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { Switch } from "@nightshift/ui/components/switch";
import { Textarea } from "@nightshift/ui/components/textarea";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@nightshift/ui/components/toggle-group";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useId, useState } from "react";
import { Field, InspectorSection, PositiveIntInput } from "../fields";
import { TemplateField } from "../template-field";

type Change = (change: (node: ValueNode) => ValueNode) => void;

/** The output fields that can hold the run's choices: text, or a list of text. */
function choiceFields(node: ValueNode): string[] {
	return askFields(node.output)
		.map((field) => field.name)
		.filter((name) => choicesFieldProblem(node.output, name) === null);
}

/** The node without one of its optional fields, or with it set. */
function withField<K extends "choices" | "attachments" | "deadline">(
	node: ValueNode,
	key: K,
	value: ValueNode[K] | undefined,
): ValueNode {
	const next: ValueNode = { ...node };
	if (value === undefined) delete next[key];
	else next[key] = value;
	return next;
}

export function AskFields({
	flow,
	node,
	onChange,
}: {
	flow: Flow;
	node: ValueNode;
	onChange: Change;
}) {
	return (
		<>
			<ChoicesSection flow={flow} node={node} onChange={onChange} />
			<AttachmentsSection flow={flow} node={node} onChange={onChange} />
			<AskDeadlineSection flow={flow} node={node} onChange={onChange} />
		</>
	);
}

/** Choices from the run: a list an earlier node made, and the output field they go to. */
function ChoicesSection({
	flow,
	node,
	onChange,
}: {
	flow: Flow;
	node: ValueNode;
	onChange: Change;
}) {
	const id = useId();
	const { choices } = node;
	const fields = choiceFields(node);
	const known = choices !== undefined && fields.includes(choices.field);
	const set = (next: ValueNode["choices"]) =>
		onChange((current) => withField(current, "choices", next));
	return (
		<InspectorSection
			title="Choices from the run"
			tab="setup"
			defaultOpen={choices !== undefined}
		>
			<ShadcnField orientation="horizontal" className="items-start">
				<Switch
					id={`${id}-on`}
					checked={choices !== undefined}
					className="mt-0.5"
					aria-describedby={`${id}-on-hint`}
					onCheckedChange={(on) =>
						set(on ? { from: "", field: fields[0] ?? "" } : undefined)
					}
				/>
				<FieldContent>
					<FieldLabel htmlFor={`${id}-on`}>
						Take the choices from the run
					</FieldLabel>
					<FieldDescription id={`${id}-on-hint`} className="text-xs">
						An earlier node makes the list. The person picks from it.
					</FieldDescription>
				</FieldContent>
			</ShadcnField>
			{choices ? (
				<>
					<TemplateField
						id={`${id}-from`}
						label="List"
						hint='A list of { "name", "label", "description", "attachments" }. Only name and label are needed.'
						flow={flow}
						nodeId={node.id}
						value={choices.from}
						placeholder="{{designer.data.variants}}"
						multiline={false}
						invalid={choices.from.trim() === ""}
						onChange={(from) => set({ ...choices, from })}
					/>
					<Field
						id={`${id}-field`}
						label="Output field"
						hint="The answer holds the chosen names in this field. A list field lets the person choose several."
						error={
							known
								? null
								: "Add a text or list field to the output schema, then pick it."
						}
					>
						<NativeSelect
							id={`${id}-field`}
							value={known ? choices.field : ""}
							aria-invalid={!known}
							aria-describedby={`${id}-field-hint`}
							onChange={(event) =>
								set({ ...choices, field: event.target.value })
							}
						>
							{known ? null : (
								<NativeSelectOption value="" disabled>
									Choose a field
								</NativeSelectOption>
							)}
							{fields.map((name) => (
								<NativeSelectOption key={name} value={name}>
									{name}
								</NativeSelectOption>
							))}
						</NativeSelect>
					</Field>
				</>
			) : null}
		</InspectorSection>
	);
}

/** Files of the run's copy of the project, or links, that the person sees with the question. */
function AttachmentsSection({
	flow,
	node,
	onChange,
}: {
	flow: Flow;
	node: ValueNode;
	onChange: Change;
}) {
	const id = useId();
	const list = node.attachments ?? [];
	const set = (next: AttachmentSource[]) =>
		onChange((current) =>
			withField(current, "attachments", next.length > 0 ? next : undefined),
		);
	const update = (index: number, next: AttachmentSource) =>
		set(list.map((one, at) => (at === index ? next : one)));
	return (
		<InspectorSection
			title="Files and links"
			tab="setup"
			defaultOpen={list.length > 0}
		>
			{list.map((attachment, index) => {
				const kind = attachment.url !== undefined ? "url" : "path";
				const value = attachment.url ?? attachment.path ?? "";
				const rowId = `${id}-${index}`;
				return (
					<div
						key={index}
						className="flex flex-col gap-2 rounded-lg border p-2"
					>
						<div className="flex items-center gap-2">
							<ToggleGroup
								variant="outline"
								size="sm"
								spacing={0}
								aria-label={`Kind of attachment ${index + 1}`}
								className="flex-1"
								value={[kind]}
								onValueChange={(next) => {
									const label = attachment.label;
									const own = label === undefined ? {} : { label };
									if (next[0] === "url") update(index, { ...own, url: "" });
									if (next[0] === "path") update(index, { ...own, path: "" });
								}}
							>
								<ToggleGroupItem
									value="path"
									className="flex-1 aria-pressed:bg-primary aria-pressed:text-primary-foreground"
								>
									File
								</ToggleGroupItem>
								<ToggleGroupItem
									value="url"
									className="flex-1 aria-pressed:bg-primary aria-pressed:text-primary-foreground"
								>
									Link
								</ToggleGroupItem>
							</ToggleGroup>
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								aria-label={`Remove attachment ${index + 1}`}
								onClick={() => set(list.filter((_, at) => at !== index))}
							>
								<Trash2Icon />
							</Button>
						</div>
						<TemplateField
							id={`${rowId}-value`}
							label={kind === "url" ? "Link" : "File"}
							hint={
								kind === "url"
									? "A web address that opens in the browser."
									: "A path in the run's copy of the project. Night Shift keeps the file with the run."
							}
							flow={flow}
							nodeId={node.id}
							value={value}
							placeholder={
								kind === "url"
									? "https://example.com/preview"
									: "screens/home.png"
							}
							multiline={false}
							invalid={value.trim() === ""}
							onChange={(text) =>
								update(
									index,
									kind === "url"
										? { ...attachment, url: text }
										: { ...attachment, path: text },
								)
							}
						/>
						<Field id={`${rowId}-label`} label="Label" optional>
							<Input
								id={`${rowId}-label`}
								value={attachment.label ?? ""}
								onChange={(event) => {
									const { label: _, ...rest } = attachment;
									const text = event.target.value;
									update(
										index,
										text.trim() === "" ? rest : { ...rest, label: text },
									);
								}}
							/>
						</Field>
					</div>
				);
			})}
			<Button
				type="button"
				variant="outline"
				size="sm"
				className="self-start"
				onClick={() => set([...list, { path: "" }])}
			>
				<PlusIcon data-icon="inline-start" />
				Add file or link
			</Button>
		</InspectorSection>
	);
}

/** The deadline with `at` or `minutes` as its time, the other one gone. */
function withTime(
	time: { at: string } | { minutes: number | undefined },
): AskDeadline {
	if ("at" in time) return { at: time.at };
	return time.minutes === undefined ? {} : { minutes: time.minutes };
}

/** The text of a default as the person writes it: JSON. */
function defaultText(value: JsonValue | undefined): string {
	return value === undefined ? "" : JSON.stringify(value, null, 2);
}

/** When Night Shift stops waiting, and the data it takes then. */
function AskDeadlineSection({
	flow,
	node,
	onChange,
}: {
	flow: Flow;
	node: ValueNode;
	onChange: Change;
}) {
	const id = useId();
	const { deadline } = node;
	const [text, setText] = useState(() => defaultText(node.default));
	const [invalid, setInvalid] = useState(false);
	const set = (next: AskDeadline | undefined) =>
		onChange((current) => {
			const updated = withField(current, "deadline", next);
			if (next !== undefined) return updated;
			const { default: _, ...rest } = updated;
			return rest;
		});
	const kind = deadline?.at !== undefined ? "time" : "minutes";
	return (
		<InspectorSection
			title="Deadline"
			tab="setup"
			defaultOpen={deadline !== undefined}
		>
			<ShadcnField orientation="horizontal" className="items-start">
				<Switch
					id={`${id}-on`}
					checked={deadline !== undefined}
					className="mt-0.5"
					aria-describedby={`${id}-on-hint`}
					onCheckedChange={(on) => set(on ? { at: "07:00" } : undefined)}
				/>
				<FieldContent>
					<FieldLabel htmlFor={`${id}-on`}>
						Stop waiting at a deadline
					</FieldLabel>
					<FieldDescription id={`${id}-on-hint`} className="text-xs">
						When nobody answers in time, Night Shift takes the default.
					</FieldDescription>
				</FieldContent>
			</ShadcnField>
			{deadline ? (
				<>
					<Field id={`${id}-kind`} label="Deadline">
						<ToggleGroup
							variant="outline"
							size="sm"
							spacing={0}
							aria-label="Deadline"
							className="w-full"
							value={[kind]}
							onValueChange={(value) => {
								if (value[0] === "time") set(withTime({ at: "07:00" }));
								if (value[0] === "minutes") set(withTime({ minutes: 60 }));
							}}
						>
							<ToggleGroupItem
								value="time"
								className="flex-1 aria-pressed:bg-primary aria-pressed:text-primary-foreground"
							>
								At a time
							</ToggleGroupItem>
							<ToggleGroupItem
								value="minutes"
								className="flex-1 aria-pressed:bg-primary aria-pressed:text-primary-foreground"
							>
								After minutes
							</ToggleGroupItem>
						</ToggleGroup>
					</Field>
					{kind === "time" ? (
						<TemplateField
							id={`${id}-at`}
							label="Time"
							hint="A time of day, such as 07:00, means the next one after the question opens. Or give a date and time: 2026-10-18T07:00."
							flow={flow}
							nodeId={node.id}
							value={deadline.at ?? ""}
							placeholder="07:00"
							multiline={false}
							invalid={(deadline.at ?? "").trim() === ""}
							onChange={(at) => set(withTime({ at }))}
						/>
					) : (
						<Field
							id={`${id}-minutes`}
							label="Minutes after the question opens"
						>
							<PositiveIntInput
								id={`${id}-minutes`}
								value={deadline.minutes}
								placeholder="60"
								onChange={(minutes) => set(withTime({ minutes }))}
							/>
						</Field>
					)}
					<Field
						id={`${id}-default`}
						label="Default"
						hint={`The data Night Shift takes. It must fit the output schema, for example { "approved": false }.`}
						error={
							invalid
								? "Check the format of the default."
								: node.default === undefined
									? "Give the data Night Shift takes when nobody answers."
									: null
						}
					>
						<Textarea
							id={`${id}-default`}
							rows={3}
							value={text}
							spellCheck={false}
							className="font-mono text-xs md:text-xs"
							aria-invalid={invalid || node.default === undefined}
							aria-describedby={`${id}-default-hint`}
							onChange={(event) => {
								const next = event.target.value;
								setText(next);
								if (next.trim() === "") {
									setInvalid(false);
									onChange(({ default: _, ...rest }) => rest);
									return;
								}
								try {
									const parsed = JSON.parse(next) as JsonValue;
									setInvalid(false);
									onChange((current) => ({ ...current, default: parsed }));
								} catch {
									setInvalid(true);
								}
							}}
						/>
					</Field>
				</>
			) : null}
		</InspectorSection>
	);
}
