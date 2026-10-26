/** The flow's inputs: what a run asks for when it starts. */
import {
	type Flow,
	type FlowInputDef,
	type NameClash,
	nameClash,
	renameInput,
	setInputs,
	uniqueName,
} from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import { Checkbox } from "@nightshift/ui/components/checkbox";
import { Field, FieldError, FieldLabel } from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import { Item } from "@nightshift/ui/components/item";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { PlusIcon } from "lucide-react";
import { useId, useState } from "react";
import { LargerTextarea } from "@/shared/larger-window";
import { type Change, move, NameInput, RowButtons } from "./io-rows";

/** Why an input cannot take a name, by what the name clashes with. */
const INPUT_NAME_TAKEN: Record<NameClash, (name: string) => string> = {
	reserved: (name) => `The name ${name} is taken. Pick another name.`,
	node: (name) => `A node is already named ${name}. Pick another name.`,
	input: (name) => `Another input is named ${name}.`,
	variable: (name) => `A variable is already named ${name}. Pick another name.`,
};

/** Whether a JSON input's default is JSON text. Empty counts as no default. */
function jsonError(text: string | undefined): string | null {
	if (text === undefined || text.trim() === "") return null;
	try {
		JSON.parse(text);
		return null;
	} catch (error) {
		return error instanceof Error ? error.message : "Not valid JSON.";
	}
}

/**
 * The flow's inputs: what a run asks when it starts, and what a Call node
 * binds when it calls the flow. A name commits on blur or Enter, so
 * the `{{name}}` references in the flow follow one rename and not every
 * keystroke.
 */
export function InputsEditor({
	flow,
	describedBy,
	onChange,
}: {
	flow: Flow;
	describedBy?: string;
	onChange: Change;
}) {
	const id = useId();
	const [focusIndex, setFocusIndex] = useState<number | null>(null);
	const inputs = flow.inputs;

	const update = (
		index: number,
		change: (input: FlowInputDef) => FlowInputDef,
	) =>
		onChange((current) =>
			setInputs(
				current,
				current.inputs.map((input, at) =>
					at === index ? change(input) : input,
				),
			),
		);

	return (
		<div className="flex flex-col gap-2">
			{inputs.length > 0 ? (
				<ol className="flex flex-col gap-1.5" aria-describedby={describedBy}>
					{inputs.map((input, index) => (
						<InputRow
							// Inputs have no ids; the row follows its place in the list.
							key={index}
							id={`${id}-${index}`}
							input={input}
							index={index}
							count={inputs.length}
							autoFocus={focusIndex === index}
							onRename={(name) => {
								const clash = nameClash(flow, name, { input: index });
								if (clash !== null) return INPUT_NAME_TAKEN[clash](name);
								onChange((current) => renameInput(current, index, name));
								return null;
							}}
							onUpdate={(change) => update(index, change)}
							onRemove={() =>
								onChange((current) =>
									setInputs(
										current,
										current.inputs.filter((_, at) => at !== index),
									),
								)
							}
							onMove={(to) =>
								onChange((current) =>
									setInputs(current, move(current.inputs, index, to)),
								)
							}
						/>
					))}
				</ol>
			) : null}
			<Button
				variant="outline"
				size="sm"
				className="self-start"
				onClick={() => {
					setFocusIndex(inputs.length);
					onChange((current) =>
						setInputs(current, [
							...current.inputs,
							{ name: uniqueName(current, "input"), type: "text" },
						]),
					);
				}}
			>
				<PlusIcon data-icon="inline-start" />
				Add input
			</Button>
		</div>
	);
}

function InputRow({
	id,
	input,
	index,
	count,
	autoFocus,
	onRename,
	onUpdate,
	onRemove,
	onMove,
}: {
	id: string;
	input: FlowInputDef;
	index: number;
	count: number;
	autoFocus: boolean;
	onRename: (name: string) => string | null;
	onUpdate: (change: (input: FlowInputDef) => FlowInputDef) => void;
	onRemove: () => void;
	onMove: (to: number) => void;
}) {
	/** Sets an optional text field, dropping it when empty. */
	const setOptional = (
		key: "label" | "description" | "default",
		value: string,
	) =>
		onUpdate((current) => {
			const next: FlowInputDef = { ...current, [key]: value };
			if (value === "") delete next[key];
			return next;
		});

	const position = `input ${index + 1}`;
	const isJson = input.type === "json";
	const defaultError = isJson ? jsonError(input.default) : null;

	return (
		<Item
			render={<li />}
			variant="outline"
			size="xs"
			className="flex-col items-stretch gap-1.5 bg-card"
		>
			<NameInput
				id={`${id}-name`}
				name={input.name}
				label={`Name of ${position}`}
				autoFocus={autoFocus}
				onCommit={onRename}
			>
				<div className="w-20 shrink-0">
					<NativeSelect
						id={`${id}-type`}
						size="sm"
						value={input.type}
						aria-label={`Type of ${position}`}
						className="w-full font-mono text-xs"
						onChange={(event) => {
							const type = event.target.value as FlowInputDef["type"];
							onUpdate((current) => ({ ...current, type }));
						}}
					>
						<NativeSelectOption value="text">text</NativeSelectOption>
						<NativeSelectOption value="json">json</NativeSelectOption>
					</NativeSelect>
				</div>
				<RowButtons
					name={input.name}
					noun="input"
					index={index}
					count={count}
					onMove={onMove}
					onRemove={onRemove}
				/>
			</NameInput>
			<Input
				id={`${id}-label`}
				value={input.label ?? ""}
				aria-label={`Label of ${position}`}
				placeholder="Label in the start dialog (optional)"
				className="h-8 text-xs"
				autoComplete="off"
				onChange={(event) => setOptional("label", event.target.value)}
			/>
			<Input
				id={`${id}-description`}
				value={input.description ?? ""}
				aria-label={`Description of ${position}`}
				placeholder="What to enter (optional)"
				className="h-8 text-xs"
				autoComplete="off"
				onChange={(event) => setOptional("description", event.target.value)}
			/>
			{isJson ? (
				<LargerTextarea
					title={`Default of ${position}`}
					id={`${id}-default`}
					value={input.default ?? ""}
					aria-label={`Default of ${position}, as JSON`}
					aria-invalid={defaultError !== null}
					aria-describedby={defaultError ? `${id}-default-error` : undefined}
					placeholder='Default, as JSON (optional): {"title": "…"}'
					className="max-h-40 min-h-12 font-mono text-xs"
					spellCheck={false}
					onChange={(event) => setOptional("default", event.target.value)}
				/>
			) : (
				<Input
					id={`${id}-default`}
					value={input.default ?? ""}
					aria-label={`Default of ${position}`}
					placeholder="Default (optional)"
					className="h-8 font-mono text-xs"
					autoComplete="off"
					spellCheck={false}
					onChange={(event) => setOptional("default", event.target.value)}
				/>
			)}
			{defaultError ? (
				<FieldError id={`${id}-default-error`} className="text-xs">
					The default is not valid JSON: {defaultError}
				</FieldError>
			) : null}
			<Field orientation="horizontal" className="gap-2 pt-0.5">
				<Checkbox
					id={`${id}-required`}
					checked={input.required === true}
					onCheckedChange={(checked) =>
						onUpdate(({ required: _, ...rest }) =>
							checked ? { ...rest, required: true } : rest,
						)
					}
				/>
				<FieldLabel
					htmlFor={`${id}-required`}
					className="gap-1 font-normal text-xs"
				>
					Required
					{input.default ? (
						<span className="text-muted-foreground">
							· the default is enough
						</span>
					) : null}
				</FieldLabel>
			</Field>
		</Item>
	);
}
