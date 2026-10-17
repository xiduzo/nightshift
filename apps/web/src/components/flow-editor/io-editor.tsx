import {
	type Flow,
	type FlowInputDef,
	type FlowOutputDef,
	nameSchema,
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
import { Textarea } from "@nightshift/ui/components/textarea";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, XIcon } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import {
	renameInput,
	setInputs,
	setOutputs,
	uniqueName,
	uniqueOutputName,
} from "@/lib/flow-draft";

import { TemplateField } from "./template-field";

/** Fields a Call node has on its own; an output may not shadow them. */
const RESERVED_OUTPUTS = ["outcome", "ended", "visit"];

type Change = (change: (flow: Flow) => Flow) => void;

function move<T>(list: T[], from: number, to: number): T[] {
	const next = [...list];
	const [moved] = next.splice(from, 1);
	if (moved !== undefined) next.splice(to, 0, moved);
	return next;
}

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
								if (name === "run")
									return "The name run is taken. Pick another name.";
								if (
									inputs.some(
										(other, at) => at !== index && other.name === name,
									)
								)
									return `Another input is named ${name}.`;
								if (flow.nodes.some((node) => node.id === name))
									return `A node is already named ${name}. Pick another name.`;
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

/** A name that commits on blur or Enter, and goes back on Escape. */
export function NameInput({
	id,
	name,
	label,
	autoFocus,
	onCommit,
	children,
}: {
	id: string;
	name: string;
	label: string;
	autoFocus: boolean;
	/** Returns an error when the name cannot be used. */
	onCommit: (name: string) => string | null;
	/** Buttons beside the name. */
	children: ReactNode;
}) {
	const [text, setText] = useState(name);
	const [error, setError] = useState<string | null>(null);
	const ref = useRef<HTMLInputElement>(null);

	// Follow outside changes: a reorder, a removal above, an undo.
	useEffect(() => {
		setText(name);
		setError(null);
	}, [name]);

	useEffect(() => {
		if (autoFocus) ref.current?.select();
	}, [autoFocus]);

	const commit = () => {
		const next = text.trim();
		if (next === name) {
			setText(name);
			setError(null);
			return;
		}
		const parsed = nameSchema.safeParse(next);
		if (!parsed.success) {
			setError(parsed.error.issues[0]?.message ?? "Not a valid name.");
			return;
		}
		setError(onCommit(next));
	};

	return (
		<>
			<div className="flex items-center gap-0.5">
				<Input
					ref={ref}
					id={id}
					value={text}
					aria-label={label}
					aria-invalid={error !== null}
					aria-describedby={error ? `${id}-error` : undefined}
					className="h-8 min-w-0 flex-1 font-mono text-xs"
					autoComplete="off"
					spellCheck={false}
					onChange={(event) => {
						setText(event.target.value);
						setError(null);
					}}
					onBlur={commit}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							commit();
						} else if (event.key === "Escape") {
							setText(name);
							setError(null);
						}
					}}
				/>
				{children}
			</div>
			{error ? (
				<FieldError id={`${id}-error`} className="text-xs">
					{error}
				</FieldError>
			) : null}
		</>
	);
}

function RowButtons({
	name,
	noun,
	index,
	count,
	onMove,
	onRemove,
}: {
	name: string;
	noun: string;
	index: number;
	count: number;
	onMove: (to: number) => void;
	onRemove: () => void;
}) {
	return (
		<>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label={`Move ${name} up`}
				title="Move up"
				disabled={index === 0}
				onClick={() => onMove(index - 1)}
			>
				<ArrowUpIcon />
			</Button>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label={`Move ${name} down`}
				title="Move down"
				disabled={index === count - 1}
				onClick={() => onMove(index + 1)}
			>
				<ArrowDownIcon />
			</Button>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label={`Remove ${name}`}
				title={`Remove this ${noun}`}
				onClick={onRemove}
			>
				<XIcon />
			</Button>
		</>
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
				<Textarea
					id={`${id}-default`}
					value={input.default ?? ""}
					aria-label={`Default of ${position}, as JSON`}
					aria-invalid={defaultError !== null}
					aria-describedby={defaultError ? `${id}-default-error` : undefined}
					placeholder='Default, as JSON (optional): {"title": "…"}'
					className="min-h-12 font-mono text-xs"
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

/**
 * The flow's outputs: values it returns to the Call node that calls
 * it, rendered from templates when the flow ends.
 */
export function OutputsEditor({
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
	const outputs = flow.outputs;

	const update = (
		index: number,
		change: (output: FlowOutputDef) => FlowOutputDef,
	) =>
		onChange((current) =>
			setOutputs(
				current,
				current.outputs.map((output, at) =>
					at === index ? change(output) : output,
				),
			),
		);

	return (
		<div className="flex flex-col gap-2">
			{outputs.length > 0 ? (
				<ol className="flex flex-col gap-1.5" aria-describedby={describedBy}>
					{outputs.map((output, index) => {
						const rowId = `${id}-${index}`;
						const position = `output ${index + 1}`;
						return (
							<Item
								render={<li />}
								// Outputs have no ids; the row follows its place in the list.
								key={index}
								variant="outline"
								size="xs"
								className="flex-col items-stretch gap-1.5 bg-card"
							>
								<NameInput
									id={`${rowId}-name`}
									name={output.name}
									label={`Name of ${position}`}
									autoFocus={focusIndex === index}
									onCommit={(name) => {
										if (RESERVED_OUTPUTS.includes(name))
											return `The name ${name} is taken. Pick another name.`;
										if (
											outputs.some(
												(other, at) => at !== index && other.name === name,
											)
										)
											return `Another output is named ${name}.`;
										update(index, (current) => ({ ...current, name }));
										return null;
									}}
								>
									<RowButtons
										name={output.name}
										noun="output"
										index={index}
										count={outputs.length}
										onMove={(to) =>
											onChange((current) =>
												setOutputs(current, move(current.outputs, index, to)),
											)
										}
										onRemove={() =>
											onChange((current) =>
												setOutputs(
													current,
													current.outputs.filter((_, at) => at !== index),
												),
											)
										}
									/>
								</NameInput>
								<TemplateField
									id={`${rowId}-value`}
									label="Value"
									flow={flow}
									nodeId={null}
									value={output.value}
									multiline={false}
									variablesOpen={false}
									placeholder="{{review.data}}"
									onChange={(value) =>
										update(index, (current) => ({ ...current, value }))
									}
								/>
								<Input
									id={`${rowId}-description`}
									value={output.description ?? ""}
									aria-label={`Description of ${position}`}
									placeholder="What it holds (optional)"
									className="h-8 text-xs"
									autoComplete="off"
									onChange={(event) => {
										const description = event.target.value;
										update(index, ({ description: _, ...rest }) =>
											description === "" ? rest : { ...rest, description },
										);
									}}
								/>
							</Item>
						);
					})}
				</ol>
			) : null}
			<Button
				variant="outline"
				size="sm"
				className="self-start"
				onClick={() => {
					setFocusIndex(outputs.length);
					onChange((current) =>
						setOutputs(current, [
							...current.outputs,
							{ name: uniqueOutputName(current, "result"), value: "" },
						]),
					);
				}}
			>
				<PlusIcon data-icon="inline-start" />
				Add output
			</Button>
		</div>
	);
}
