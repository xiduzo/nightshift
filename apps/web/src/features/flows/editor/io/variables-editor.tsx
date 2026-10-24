/** The flow's variables: values the steps of a run read and set. */
import {
	type Flow,
	type FlowVariableDef,
	renameVariable,
	setVariables,
	uniqueName,
	type VariableType,
	variableTypeSchema,
} from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
} from "@nightshift/ui/components/empty";
import { Input } from "@nightshift/ui/components/input";
import { Item } from "@nightshift/ui/components/item";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { PlusIcon } from "lucide-react";
import { useId, useState } from "react";
import { OutputSchemaField } from "../output-schema-field";
import { TemplateField } from "../template-field";
import { type Change, move, NameInput, RowButtons } from "./io-rows";

/** What each type of a variable holds, for its select. */
const VARIABLE_TYPES: Record<VariableType, string> = {
	text: "text",
	number: "number",
	boolean: "yes or no",
	json: "json",
};

/**
 * The flow's variables: values it keeps while it runs. Each starts from its
 * initial value, and nodes change it under Set variables. A name commits on
 * blur or Enter, so the references in the flow follow one rename.
 */
export function VariablesEditor({
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
	const variables = flow.variables ?? [];

	const update = (
		index: number,
		change: (variable: FlowVariableDef) => FlowVariableDef,
	) =>
		onChange((current) =>
			setVariables(
				current,
				(current.variables ?? []).map((variable, at) =>
					at === index ? change(variable) : variable,
				),
			),
		);

	return (
		<div className="flex flex-col gap-2">
			{variables.length > 0 ? (
				<ol className="flex flex-col gap-1.5" aria-describedby={describedBy}>
					{variables.map((variable, index) => (
						<VariableRow
							// Variables have no ids; the row follows its place in the list.
							key={index}
							id={`${id}-${index}`}
							flow={flow}
							variable={variable}
							index={index}
							count={variables.length}
							autoFocus={focusIndex === index}
							onRename={(name) => {
								if (name === "run" || name === "vars")
									return `The name ${name} is taken. Pick another name.`;
								if (
									variables.some(
										(other, at) => at !== index && other.name === name,
									)
								)
									return `Another variable is named ${name}.`;
								if (flow.inputs.some((input) => input.name === name))
									return `An input is already named ${name}. Pick another name.`;
								if (flow.nodes.some((node) => node.id === name))
									return `A node is already named ${name}. Pick another name.`;
								onChange((current) => renameVariable(current, index, name));
								return null;
							}}
							onUpdate={(change) => update(index, change)}
							onRemove={() =>
								onChange((current) =>
									setVariables(
										current,
										(current.variables ?? []).filter((_, at) => at !== index),
									),
								)
							}
							onMove={(to) =>
								onChange((current) =>
									setVariables(
										current,
										move(current.variables ?? [], index, to),
									),
								)
							}
						/>
					))}
				</ol>
			) : (
				<Empty className="gap-2 border border-dashed p-4 md:p-4">
					<EmptyHeader>
						<EmptyDescription className="text-xs">
							No variables yet. Add one to keep a value between steps, such as
							each failed check.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			)}
			<Button
				variant="outline"
				size="sm"
				className="self-start"
				onClick={() => {
					setFocusIndex(variables.length);
					onChange((current) =>
						setVariables(current, [
							...(current.variables ?? []),
							{ name: uniqueName(current, "value"), type: "text" },
						]),
					);
				}}
			>
				<PlusIcon data-icon="inline-start" />
				Add variable
			</Button>
		</div>
	);
}

function VariableRow({
	id,
	flow,
	variable,
	index,
	count,
	autoFocus,
	onRename,
	onUpdate,
	onRemove,
	onMove,
}: {
	id: string;
	flow: Flow;
	variable: FlowVariableDef;
	index: number;
	count: number;
	autoFocus: boolean;
	onRename: (name: string) => string | null;
	onUpdate: (change: (variable: FlowVariableDef) => FlowVariableDef) => void;
	onRemove: () => void;
	onMove: (to: number) => void;
}) {
	/** Sets an optional text field, dropping it when empty. */
	const setOptional = (key: "description" | "initial", value: string) =>
		onUpdate((current) => {
			const next: FlowVariableDef = { ...current, [key]: value };
			if (value === "") delete next[key];
			return next;
		});

	const position = `variable ${index + 1}`;

	return (
		<Item
			render={<li />}
			variant="outline"
			size="xs"
			className="flex-col items-stretch gap-1.5 bg-card"
		>
			<NameInput
				id={`${id}-name`}
				name={variable.name}
				label={`Name of ${position}`}
				autoFocus={autoFocus}
				onCommit={onRename}
			>
				<div className="w-24 shrink-0">
					<NativeSelect
						id={`${id}-type`}
						size="sm"
						value={variable.type}
						aria-label={`Type of ${position}`}
						className="w-full font-mono text-xs"
						onChange={(event) => {
							const type = event.target.value as VariableType;
							// Only a json variable takes a schema.
							onUpdate(({ schema: _, ...rest }) =>
								type === "json" && variable.schema !== undefined
									? { ...rest, type, schema: variable.schema }
									: { ...rest, type },
							);
						}}
					>
						{variableTypeSchema.options.map((type) => (
							<NativeSelectOption key={type} value={type}>
								{VARIABLE_TYPES[type]}
							</NativeSelectOption>
						))}
					</NativeSelect>
				</div>
				<RowButtons
					name={variable.name}
					noun="variable"
					index={index}
					count={count}
					onMove={onMove}
					onRemove={onRemove}
				/>
			</NameInput>
			<Input
				id={`${id}-description`}
				value={variable.description ?? ""}
				aria-label={`Description of ${position}`}
				placeholder="What it holds (optional)"
				className="h-8 text-xs"
				autoComplete="off"
				onChange={(event) => setOptional("description", event.target.value)}
			/>
			<TemplateField
				id={`${id}-initial`}
				label="Initial value"
				hint={
					<>
						The value when the flow starts. Use an input, for example{" "}
						<code>{"{{item.number}}"}</code>.
					</>
				}
				flow={flow}
				nodeId={null}
				scopes={["inputs", "run"]}
				value={variable.initial ?? ""}
				onChange={(value) => setOptional("initial", value)}
				placeholder={variable.type === "json" ? "[]" : "Empty (optional)"}
				multiline={false}
			/>
			{variable.type === "json" ? (
				<OutputSchemaField
					id={`${id}-schema`}
					nodeId={variable.name}
					reference={`vars.${variable.name}`}
					label="Shape"
					output={variable.schema}
					description="The shape every value must have. A write that does not fit fails its step."
					onChange={(schema) =>
						onUpdate(({ schema: _, ...rest }) =>
							schema === undefined ? rest : { ...rest, schema },
						)
					}
				/>
			) : null}
		</Item>
	);
}
