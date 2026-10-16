import type { Flow, ForEachNode, ListSource } from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@nightshift/ui/components/dropdown-menu";
import {
	FieldDescription,
	FieldLegend,
	FieldSet,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { ChevronDownIcon, PlusIcon, TriangleAlertIcon } from "lucide-react";
import { useId, useRef } from "react";

import {
	calledFlow,
	emptySource,
	nodeOptions,
	SOURCE_KINDS,
} from "@/lib/flow-draft";
import { LIST_RECIPES } from "@/lib/list-recipes";

import {
	CalledFlowField,
	type CalledFlowSupport,
	InputBindings,
} from "./called-flow-fields";
import { Field, InspectorSection, Note, PositiveIntInput } from "./fields";
import { OptionsEditor } from "./options-editor";
import { TemplateField } from "./template-field";

const SOURCE_ORDER: ListSource["kind"][] = ["json", "command", "files"];

export function ForEachFields({
	flow,
	node,
	support,
	onChange,
}: {
	flow: Flow;
	node: ForEachNode;
	support: CalledFlowSupport;
	onChange: (change: (node: ForEachNode) => ForEachNode) => void;
}) {
	const id = useId();
	// Switching the source kind back and forth keeps what was typed.
	const lastSource = useRef<Partial<Record<ListSource["kind"], ListSource>>>(
		{},
	);
	const setSource = (source: ListSource) =>
		onChange((current) => ({ ...current, source }));

	const called = calledFlow(node, support.flows);

	return (
		<>
			<InspectorSection title="Items">
				<Field
					id={`${id}-kind`}
					label="Items from"
					hint="Night Shift reads the list again before each item, so items added during the run run too."
				>
					<NativeSelect
						id={`${id}-kind`}
						value={node.source.kind}
						aria-describedby={`${id}-kind-hint`}
						onChange={(event) => {
							const kind = event.target.value as ListSource["kind"];
							if (kind === node.source.kind) return;
							lastSource.current[node.source.kind] = node.source;
							setSource(lastSource.current[kind] ?? emptySource(kind));
						}}
					>
						{SOURCE_ORDER.map((kind) => (
							<NativeSelectOption key={kind} value={kind}>
								{SOURCE_KINDS[kind]}
							</NativeSelectOption>
						))}
					</NativeSelect>
				</Field>

				<SourceFields flow={flow} node={node} onChange={setSource} />
			</InspectorSection>

			<InspectorSection title="Each item runs">
				<CalledFlowField
					id={`${id}-flow`}
					node={node}
					support={support}
					hint="Runs once for each item. The item goes to one of its inputs."
					onPick={(name) => onChange((current) => ({ ...current, flow: name }))}
				/>

				<AsField
					id={`${id}-as`}
					node={node}
					called={called}
					onChange={(as) => onChange((current) => ({ ...current, as }))}
				/>

				<InputBindings
					flow={flow}
					node={node}
					called={called}
					skip={node.as}
					onChange={(inputs) => onChange((current) => ({ ...current, inputs }))}
				/>
			</InspectorSection>

			<InspectorSection title="Loop">
				<Field
					id={`${id}-branch`}
					label="Branch"
					hint={
						node.branch === "per-item"
							? "Each item gets its own branch, on top of the last item that finished. Use {{run.branch}} and {{run.base_branch}} to read them."
							: "All items work on the same branch, one after the other."
					}
				>
					<NativeSelect
						id={`${id}-branch`}
						value={node.branch}
						aria-describedby={`${id}-branch-hint`}
						onChange={(event) => {
							const branch = event.target.value as ForEachNode["branch"];
							onChange((current) => ({ ...current, branch }));
						}}
					>
						<NativeSelectOption value="per-item">
							A branch per item (a stack)
						</NativeSelectOption>
						<NativeSelectOption value="shared">
							One shared branch
						</NativeSelectOption>
					</NativeSelect>
				</Field>

				<HaltOnField
					id={`${id}-halt`}
					node={node}
					called={called}
					onChange={(haltOn) => onChange((current) => ({ ...current, haltOn }))}
				/>

				<Field
					id={`${id}-max`}
					label="Max items"
					optional
					hint="The most items to start, as a safety net."
				>
					<PositiveIntInput
						id={`${id}-max`}
						value={node.maxItems}
						placeholder="No limit"
						describedBy={`${id}-max-hint`}
						onChange={(maxItems) =>
							onChange((current) => ({ ...current, maxItems }))
						}
					/>
				</Field>

				<Note>
					Ends with <span className="text-foreground">done</span> when no item
					is left to start, or <span className="text-foreground">halted</span>.
					A failed item blocks the items that depend on it. Later nodes read{" "}
					<code>{`{{${node.id}.summary}}`}</code>,{" "}
					<code>{`{{${node.id}.done_count}}`}</code>, and each item's result in{" "}
					<code>{`{{${node.id}.results}}`}</code>.
				</Note>
			</InspectorSection>
		</>
	);
}

/** The fields of the picked source kind. */
function SourceFields({
	flow,
	node,
	onChange,
}: {
	flow: Flow;
	node: ForEachNode;
	onChange: (source: ListSource) => void;
}) {
	const id = useId();
	const { source } = node;
	switch (source.kind) {
		case "json":
			return (
				<TemplateField
					id={`${id}-value`}
					label="List"
					hint={
						<>
							A list, for example{" "}
							<code className="font-mono">{"{{planner.data.tasks}}"}</code>, or
							the list itself as JSON.
						</>
					}
					flow={flow}
					nodeId={node.id}
					value={source.value}
					invalid={source.value.trim() === ""}
					multiline={false}
					placeholder="{{planner.data.tasks}}"
					onChange={(value) => onChange({ kind: "json", value })}
				/>
			);
		case "command":
			return (
				<div className="flex flex-col gap-2">
					<TemplateField
						id={`${id}-command`}
						label="Source command"
						hint="A shell command that prints the list as JSON, for example cat tasks.json. A recipe replaces what is here."
						flow={flow}
						nodeId={node.id}
						value={source.command}
						invalid={source.command.trim() === ""}
						className="min-h-16"
						variablesOpen={false}
						placeholder="cat tasks.json"
						onChange={(command) => onChange({ kind: "command", command })}
					/>
					<RecipePicker
						onPick={(command) => onChange({ kind: "command", command })}
					/>
				</div>
			);
		case "files":
			return (
				<TemplateField
					id={`${id}-glob`}
					label="File pattern"
					hint={
						<>
							Each matching file is one item, in path order. Use{" "}
							<code className="font-mono">{`{{${node.as}.path}}`}</code> for its
							path.
						</>
					}
					flow={flow}
					nodeId={node.id}
					value={source.glob}
					invalid={source.glob.trim() === ""}
					multiline={false}
					variablesOpen={false}
					placeholder="src/**/*.test.ts"
					onChange={(glob) => onChange({ kind: "files", glob })}
				/>
			);
	}
}

/**
 * Fills the source command with a recipe: a command on a tracker's CLI or
 * a file that prints the list as JSON. The person edits it from there.
 */
function RecipePicker({ onPick }: { onPick: (command: string) => void }) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						variant="outline"
						size="sm"
						className="self-start font-normal"
					/>
				}
			>
				Start from a recipe
				<ChevronDownIcon data-icon="inline-end" aria-hidden="true" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-80">
				{LIST_RECIPES.map((recipe) => (
					<DropdownMenuItem
						key={recipe.name}
						className="flex-col items-start gap-0.5"
						onClick={() => onPick(recipe.command)}
					>
						<span>{recipe.name}</span>
						<span className="text-muted-foreground text-xs">
							{recipe.description}
						</span>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/**
 * The input of the called flow that takes the element: a pick among its
 * inputs (JSON ones first), or free text while the flow is not picked.
 */
function AsField({
	id,
	node,
	called,
	onChange,
}: {
	id: string;
	node: ForEachNode;
	called: Flow | null;
	onChange: (as: string) => void;
}) {
	const inputs = called
		? [...called.inputs].sort(
				(a, b) => Number(b.type === "json") - Number(a.type === "json"),
			)
		: [];
	const picked = inputs.find((input) => input.name === node.as);
	const missing = called !== null && !picked;
	const hint =
		picked?.type === "text"
			? "A text input gets the item as text. Use a json input to read its fields."
			: `The called flow gets the item in this input, and reads it as {{${node.as}}} or {{${node.as}.title}}.`;

	return (
		<Field
			id={id}
			label="Item goes to input"
			hint={hint}
			error={
				missing
					? `${node.flow} has no input ${node.as}. Pick one, or add a json input to it.`
					: null
			}
		>
			{called && inputs.length > 0 ? (
				<NativeSelect
					id={id}
					value={node.as}
					className="font-mono"
					aria-invalid={missing}
					aria-describedby={`${id}-hint`}
					onChange={(event) => onChange(event.target.value)}
				>
					{missing ? (
						<NativeSelectOption value={node.as}>
							{node.as} (missing)
						</NativeSelectOption>
					) : null}
					{inputs.map((input) => (
						<NativeSelectOption key={input.name} value={input.name}>
							{input.name} · {input.type}
							{input.label ? ` · ${input.label}` : ""}
						</NativeSelectOption>
					))}
				</NativeSelect>
			) : (
				<Input
					id={id}
					value={node.as}
					className="font-mono"
					autoComplete="off"
					spellCheck={false}
					aria-invalid={missing}
					aria-describedby={`${id}-hint`}
					onChange={(event) => onChange(event.target.value.trim())}
				/>
			)}
			{picked?.type === "text" ? (
				<p className="flex items-start gap-1.5 text-status-waiting text-xs">
					<TriangleAlertIcon
						className="mt-px size-3.5 shrink-0"
						aria-hidden="true"
					/>
					{node.as} is a text input.
				</p>
			) : null}
		</Field>
	);
}

/** The outcomes that stop the loop, with the called flow's own ones as suggestions. */
function HaltOnField({
	id,
	node,
	called,
	onChange,
}: {
	id: string;
	node: ForEachNode;
	/** The called flow, when it loads. */
	called: Flow | null;
	onChange: (haltOn: string[]) => void;
}) {
	const suggestions = [
		...new Set(
			(called?.nodes ?? []).flatMap((calledNode) =>
				calledNode.type === "decision" || calledNode.type === "agent"
					? nodeOptions(calledNode).map((option) => option.name)
					: [],
			),
		),
	].filter((name) => !node.haltOn.includes(name));

	return (
		<FieldSet className="gap-2">
			<FieldLegend variant="label" className="mb-0">
				Halt on
			</FieldLegend>
			<FieldDescription id={`${id}-hint`} className="text-xs">
				When the called flow ends on one of these outcomes, the loop stops as
				halted.
			</FieldDescription>
			<OptionsEditor
				kind="option"
				options={node.haltOn.map((name) => ({ name }))}
				min={0}
				newName="halt"
				describedBy={`${id}-hint`}
				onRename={(index, name) => {
					onChange(node.haltOn.map((old, at) => (at === index ? name : old)));
					return null;
				}}
				onAdd={(option) => onChange([...node.haltOn, option.name])}
				onRemove={(index) =>
					onChange(node.haltOn.filter((_, at) => at !== index))
				}
			/>
			{suggestions.length > 0 ? (
				<div className="flex flex-wrap items-center gap-1 text-muted-foreground text-xs">
					<span className="mr-0.5">
						From <span className="font-mono">{node.flow}</span>:
					</span>
					{suggestions.map((name) => (
						<Button
							key={name}
							variant="outline"
							size="xs"
							className="h-6 border-dashed px-1.5 font-mono font-normal text-[11px]"
							title={`Halt on ${name}`}
							aria-label={`+ ${name}`}
							onClick={() => onChange([...node.haltOn, name])}
						>
							<PlusIcon data-icon="inline-start" aria-hidden="true" />
							{name}
						</Button>
					))}
				</div>
			) : null}
		</FieldSet>
	);
}
