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
import { Input } from "@nightshift/ui/components/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { Textarea } from "@nightshift/ui/components/textarea";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useId, useState } from "react";
import {
	ChoiceField,
	ChoiceToggle,
	Field,
	InspectorSection,
	NumberField,
	SwitchField,
	withOptional,
} from "../form";
import { TemplateField } from "../template";

const ATTACHMENT_KINDS = [
	{ value: "path", label: "File" },
	{ value: "url", label: "Link" },
] as const;

type Change = (change: (node: ValueNode) => ValueNode) => void;

/** The output fields that can hold the run's choices: text, or a list of text. */
function choiceFields(node: ValueNode): string[] {
	return askFields(node.output)
		.map((field) => field.name)
		.filter((name) => choicesFieldProblem(node.output, name) === null);
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
		onChange((current) => withOptional(current, "choices", next));
	return (
		<InspectorSection
			title="Choices from the run"
			tab="setup"
			defaultOpen={choices !== undefined}
		>
			<SwitchField
				id={`${id}-on`}
				label="Take the choices from the run"
				description="An earlier node makes the list. The person picks from it."
				checked={choices !== undefined}
				onChange={(on) =>
					set(on ? { from: "", field: fields[0] ?? "" } : undefined)
				}
			/>
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
			withOptional(current, "attachments", next.length > 0 ? next : undefined),
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
							<ChoiceToggle
								label={`Kind of attachment ${index + 1}`}
								className="flex-1"
								value={kind}
								choices={ATTACHMENT_KINDS}
								onChange={(next) => {
									const label = attachment.label;
									const own = label === undefined ? {} : { label };
									update(
										index,
										next === "url" ? { ...own, url: "" } : { ...own, path: "" },
									);
								}}
							/>
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
									const text = event.target.value;
									update(
										index,
										withOptional(
											attachment,
											"label",
											text.trim() === "" ? undefined : text,
										),
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

const DEADLINE_KINDS = [
	{ value: "time", label: "At a time" },
	{ value: "minutes", label: "After minutes" },
] as const;

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
			const updated = withOptional(current, "deadline", next);
			return next === undefined
				? withOptional(updated, "default", undefined)
				: updated;
		});
	const kind = deadline?.at !== undefined ? "time" : "minutes";
	return (
		<InspectorSection
			title="Deadline"
			tab="setup"
			defaultOpen={deadline !== undefined}
		>
			<SwitchField
				id={`${id}-on`}
				label="Stop waiting at a deadline"
				description="When nobody answers in time, Night Shift takes the default."
				checked={deadline !== undefined}
				onChange={(on) => set(on ? { at: "07:00" } : undefined)}
			/>
			{deadline ? (
				<>
					<ChoiceField
						id={`${id}-kind`}
						label="Deadline"
						value={kind}
						choices={DEADLINE_KINDS}
						onChange={(next) =>
							set(withTime(next === "time" ? { at: "07:00" } : { minutes: 60 }))
						}
					/>
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
						<NumberField
							id={`${id}-minutes`}
							label="Minutes after the question opens"
							value={deadline.minutes}
							placeholder="60"
							onChange={(minutes) => set(withTime({ minutes }))}
						/>
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
									onChange((current) =>
										withOptional(current, "default", undefined),
									);
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
