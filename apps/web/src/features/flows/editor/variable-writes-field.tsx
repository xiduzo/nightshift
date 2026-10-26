import {
	type Flow,
	type FlowNode,
	nodeOutcomes,
	type VariableWrite,
	withWrites,
} from "@nightshift/flows";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import { Input } from "@nightshift/ui/components/input";
import { Item } from "@nightshift/ui/components/item";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@nightshift/ui/components/toggle-group";
import { PlusIcon, XIcon } from "lucide-react";
import { useId } from "react";

import { SetSuggest } from "../assistant/field-helpers";
import { Field, InspectorSection, Note } from "./fields";
import { TemplateField } from "./template-field";

type Source = "value" | "expression";

/** Whether the write reads a template (`value`) or a JSONata expression. */
function sourceOf(write: VariableWrite): Source {
	return write.expression !== undefined ? "expression" : "value";
}

/**
 * Set variables: the node's writes to the flow's variables, applied in
 * order when its step ends. Each takes a template or an expression, and
 * the outcomes it writes on (none picked: every outcome).
 */
export function VariableWritesSection({
	flow,
	node,
	onChange,
}: {
	flow: Flow;
	node: FlowNode;
	onChange: (change: (node: FlowNode) => FlowNode) => void;
}) {
	const id = useId();
	const variables = flow.variables ?? [];
	const writes = node.set ?? [];

	const setWrites = (change: (writes: VariableWrite[]) => VariableWrite[]) =>
		onChange((current) => withWrites(current, change(current.set ?? [])));
	const update = (
		index: number,
		change: (write: VariableWrite) => VariableWrite,
	) =>
		setWrites((current) =>
			current.map((write, at) => (at === index ? change(write) : write)),
		);

	return (
		<InspectorSection
			title="Set variables"
			defaultOpen={writes.length > 0}
			aside={
				writes.length > 0 ? (
					<Badge variant="secondary" className="tabular-nums">
						{writes.length}
					</Badge>
				) : null
			}
			className="gap-3"
		>
			<Note id={`${id}-hint`}>
				Changes these variables when the step ends, in this order. Read this
				step's own results as <code>{`{{${node.id}.outcome}}`}</code>.
			</Note>
			{variables.length === 0 && writes.length === 0 ? (
				<>
					<Note>
						This flow has no variables yet. Click an empty spot on the canvas,
						then add one under Variables. Or let an agent suggest them.
					</Note>
					<div className="self-start">
						<SetSuggest node={node} />
					</div>
				</>
			) : (
				<>
					{writes.length > 0 ? (
						<ol
							className="flex flex-col gap-1.5"
							aria-describedby={`${id}-hint`}
						>
							{writes.map((write, index) => (
								<WriteRow
									// Writes have no ids; the row follows its place in the list.
									key={index}
									id={`${id}-${index}`}
									flow={flow}
									node={node}
									write={write}
									index={index}
									onChange={(change) => update(index, change)}
									onRemove={() =>
										setWrites((current) =>
											current.filter((_, at) => at !== index),
										)
									}
								/>
							))}
						</ol>
					) : null}
					<div className="flex flex-wrap items-center gap-1.5">
						<Button
							variant="outline"
							size="sm"
							disabled={variables.length === 0}
							onClick={() =>
								setWrites((current) => [
									...current,
									{ variable: variables[0]?.name ?? "", value: "" },
								])
							}
						>
							<PlusIcon data-icon="inline-start" />
							Set a variable
						</Button>
						<SetSuggest node={node} />
					</div>
				</>
			)}
		</InspectorSection>
	);
}

function WriteRow({
	id,
	flow,
	node,
	write,
	index,
	onChange,
	onRemove,
}: {
	id: string;
	flow: Flow;
	node: FlowNode;
	write: VariableWrite;
	index: number;
	onChange: (change: (write: VariableWrite) => VariableWrite) => void;
	onRemove: () => void;
}) {
	const variables = flow.variables ?? [];
	const known = variables.some((v) => v.name === write.variable);
	const source = sourceOf(write);
	const text = (source === "expression" ? write.expression : write.value) ?? "";
	const outcomes = nodeOutcomes(node);
	const position = `write ${index + 1}`;

	/** Moves the text to the other source, so switching keeps what you wrote. */
	const switchTo = (next: Source) =>
		onChange(({ value: _value, expression: _expression, ...rest }) =>
			next === "expression"
				? { ...rest, expression: text }
				: { ...rest, value: text },
		);

	return (
		<Item
			render={<li />}
			variant="outline"
			size="xs"
			className="flex-col items-stretch gap-2 bg-card"
		>
			<div className="flex items-center gap-1">
				<NativeSelect
					id={`${id}-variable`}
					size="sm"
					value={write.variable}
					aria-label={`Variable of ${position}`}
					aria-invalid={!known}
					className="w-full font-mono text-xs"
					onChange={(event) => {
						const variable = event.target.value;
						onChange((current) => ({ ...current, variable }));
					}}
				>
					{known ? null : (
						<NativeSelectOption value={write.variable}>
							{write.variable === ""
								? "Pick a variable"
								: `${write.variable} (not in this flow)`}
						</NativeSelectOption>
					)}
					{variables.map((variable) => (
						<NativeSelectOption key={variable.name} value={variable.name}>
							{variable.name}
						</NativeSelectOption>
					))}
				</NativeSelect>
				<ToggleGroup
					variant="outline"
					size="sm"
					spacing={0}
					aria-label={`Set ${position} from`}
					value={[source]}
					onValueChange={(value) => {
						const next = value[0] as Source | undefined;
						if (next !== undefined && next !== source) switchTo(next);
					}}
				>
					<ToggleGroupItem value="value" className="text-xs">
						Template
					</ToggleGroupItem>
					<ToggleGroupItem value="expression" className="text-xs">
						Expression
					</ToggleGroupItem>
				</ToggleGroup>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={`Remove ${position}`}
					title="Remove this write"
					onClick={onRemove}
				>
					<XIcon />
				</Button>
			</div>
			{source === "value" ? (
				<TemplateField
					id={`${id}-value`}
					label="Value"
					hint={
						<>
							One reference keeps its JSON value, for example{" "}
							<code>{`{{${node.id}.outcome}}`}</code>.
						</>
					}
					flow={flow}
					nodeId={null}
					value={text}
					onChange={(value) =>
						onChange(({ expression: _, ...rest }) => ({ ...rest, value }))
					}
					multiline={false}
				/>
			) : (
				<Field
					id={`${id}-expression`}
					label="Expression"
					hint={
						<>
							A JSONata expression, for example <code>vars.tries + 1</code>.
						</>
					}
				>
					<Input
						id={`${id}-expression`}
						value={text}
						placeholder="vars.tries + 1"
						className="font-mono text-xs"
						autoComplete="off"
						spellCheck={false}
						aria-describedby={`${id}-expression-hint`}
						onChange={(event) => {
							const expression = event.target.value;
							onChange(({ value: _, ...rest }) => ({ ...rest, expression }));
						}}
					/>
				</Field>
			)}
			<Field
				id={`${id}-on`}
				label="When the step ends with"
				hint="Pick none to set it on every outcome."
			>
				<ToggleGroup
					id={`${id}-on`}
					multiple
					variant="outline"
					size="sm"
					className="flex-wrap"
					aria-describedby={`${id}-on-hint`}
					value={write.on ?? []}
					onValueChange={(value) => {
						const on = (value as string[]).filter((name) =>
							outcomes.includes(name),
						);
						onChange(({ on: _, ...rest }) =>
							on.length > 0 ? { ...rest, on } : rest,
						);
					}}
				>
					{outcomes.map((outcome) => (
						<ToggleGroupItem
							key={outcome}
							value={outcome}
							className="font-mono text-xs"
						>
							{outcome}
						</ToggleGroupItem>
					))}
				</ToggleGroup>
			</Field>
		</Item>
	);
}
