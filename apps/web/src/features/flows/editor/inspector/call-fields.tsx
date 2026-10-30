import type { CallEach, CallNode, Flow, ListSource } from "@nightshift/flows";
import {
	calledFlow,
	defaultEach,
	emptySource,
	nodeOptions,
} from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import {
	FieldContent,
	FieldDescription,
	FieldLabel,
	FieldLegend,
	FieldSet,
	Field as ShadcnField,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { Switch } from "@nightshift/ui/components/switch";
import { PlusIcon, TriangleAlertIcon } from "lucide-react";
import { useId, useRef } from "react";
import { CommandSuggest } from "../../assistant/field-helpers";
import { SOURCE_KINDS } from "../../flow-draft";
import { useCommandToolField } from "../cli-tools-field";
import { Field, InspectorSection, Note, PositiveIntInput } from "../fields";
import { OptionsEditor } from "../options-editor";
import { TemplateField } from "../template-field";
import {
	CalledFlowField,
	type CalledFlowSupport,
	InputBindings,
} from "./called-flow-fields";

const SOURCE_ORDER: ListSource["kind"][] = ["json", "command"];

/**
 * One Call node, two ways to run: once, or once per item in a list. The
 * switch reveals the list fields; `onSetEach` changes the node's outcomes
 * with it (pass and fail, or done and halted), so the editor drops the
 * edges that no longer fit.
 */
export function CallFields({
	flow,
	node,
	support,
	onChange,
	onSetEach,
}: {
	flow: Flow;
	node: CallNode;
	support: CalledFlowSupport;
	onChange: (change: (node: CallNode) => CallNode) => void;
	onSetEach: (each: CallEach | undefined) => void;
}) {
	const id = useId();
	const called = calledFlow(node.flow, support.flows) ?? null;
	// Switching "once per item" off and on keeps the list fields.
	const lastEach = useRef<CallEach | undefined>(undefined);
	const { each } = node;

	return (
		<>
			<InspectorSection title="Called flow">
				<CalledFlowField
					id={`${id}-flow`}
					node={node}
					support={support}
					hint={
						each
							? "Runs once for each item. The item goes to one of its inputs."
							: "Runs once. This node passes when the called flow finishes, and fails when it does not."
					}
					onPick={(name) => onChange((current) => ({ ...current, flow: name }))}
				/>

				<ShadcnField orientation="horizontal" className="items-start">
					<Switch
						id={`${id}-each`}
						checked={each !== undefined}
						className="mt-0.5"
						aria-describedby={`${id}-each-hint`}
						onCheckedChange={(on) => {
							if (on === (each !== undefined)) return;
							if (!on) lastEach.current = each;
							onSetEach(on ? (lastEach.current ?? defaultEach()) : undefined);
						}}
					/>
					<FieldContent>
						<FieldLabel htmlFor={`${id}-each`}>Run once per item</FieldLabel>
						<FieldDescription id={`${id}-each-hint`} className="text-xs">
							{each
								? "The flow runs for each item in a list. This node ends with done, halted, or stopped."
								: "The flow runs one time. This node ends with pass, fail, or stopped."}
						</FieldDescription>
					</FieldContent>
				</ShadcnField>

				{each ? null : (
					<>
						<InputBindings
							flow={flow}
							node={node}
							called={called}
							onChange={(inputs) =>
								onChange((current) => ({ ...current, inputs }))
							}
						/>
						<OnceNote node={node} called={called} />
					</>
				)}
			</InspectorSection>

			{each ? (
				<EachFields
					flow={flow}
					node={node}
					each={each}
					called={called}
					onChange={onChange}
				/>
			) : null}
		</>
	);
}

/** What later nodes read from a Call that runs once. */
function OnceNote({ node, called }: { node: CallNode; called: Flow | null }) {
	const outputs = called?.outputs ?? [];
	return (
		<Note>
			Later nodes read <code>{`{{${node.id}.ended}}`}</code> (the outcome the
			called flow ended on)
			{outputs.length > 0 ? (
				<>
					{" "}
					and its outputs:{" "}
					{outputs.map((output, index) => (
						<span key={output.name}>
							{index > 0 ? ", " : null}
							<code>{`{{${node.id}.${output.name}}}`}</code>
						</span>
					))}
				</>
			) : null}
			.
		</Note>
	);
}

/** The list fields of a Call that runs once per item: the items, the input each goes to, the loop. */
function EachFields({
	flow,
	node,
	each,
	called,
	onChange,
}: {
	flow: Flow;
	node: CallNode;
	each: CallEach;
	called: Flow | null;
	onChange: (change: (node: CallNode) => CallNode) => void;
}) {
	const id = useId();
	// Switching the source kind back and forth keeps what was typed.
	const lastSource = useRef<Partial<Record<ListSource["kind"], ListSource>>>(
		{},
	);
	const changeEach = (change: (each: CallEach) => CallEach) =>
		onChange((current) =>
			current.each ? { ...current, each: change(current.each) } : current,
		);
	const setSource = (source: ListSource) =>
		changeEach((current) => ({ ...current, source }));

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
						value={each.source.kind}
						aria-describedby={`${id}-kind-hint`}
						onChange={(event) => {
							const kind = event.target.value as ListSource["kind"];
							if (kind === each.source.kind) return;
							lastSource.current[each.source.kind] = each.source;
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

				<SourceFields
					flow={flow}
					node={node}
					each={each}
					onChange={setSource}
				/>
			</InspectorSection>

			<InspectorSection title="Each item runs">
				<AsField
					id={`${id}-as`}
					node={node}
					each={each}
					called={called}
					onChange={(as) => changeEach((current) => ({ ...current, as }))}
				/>

				<InputBindings
					flow={flow}
					node={node}
					called={called}
					skip={each.as}
					onChange={(inputs) => onChange((current) => ({ ...current, inputs }))}
				/>
			</InspectorSection>

			<InspectorSection title="Loop">
				<Field
					id={`${id}-branch`}
					label="Branch"
					hint={
						each.branch === "per-item"
							? "Each item gets its own branch, on top of the last item that finished. Use {{run.branch}} and {{run.base_branch}} to read them."
							: "All items work on the same branch, one after the other."
					}
				>
					<NativeSelect
						id={`${id}-branch`}
						value={each.branch}
						aria-describedby={`${id}-branch-hint`}
						onChange={(event) => {
							const branch = event.target.value as CallEach["branch"];
							changeEach((current) => ({ ...current, branch }));
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
					each={each}
					called={called}
					onChange={(haltOn) =>
						changeEach((current) => ({ ...current, haltOn }))
					}
				/>

				<Field
					id={`${id}-max`}
					label="Max items"
					optional
					hint="The most items to start, as a safety net."
				>
					<PositiveIntInput
						id={`${id}-max`}
						value={each.maxItems}
						placeholder="No limit"
						describedBy={`${id}-max-hint`}
						onChange={(maxItems) =>
							changeEach(({ maxItems: _, ...current }) =>
								maxItems === undefined ? current : { ...current, maxItems },
							)
						}
					/>
				</Field>

				<Note>
					Ends with <span className="text-foreground">done</span> when no item
					is left to start, or <span className="text-foreground">halted</span>.
					It ends with <span className="text-foreground">stopped</span> at the
					stop time. Connect <span className="text-foreground">stopped</span> to
					nodes that still run after the stop time, for example a report. A
					failed item blocks the items that depend on it. Later nodes read{" "}
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
	each,
	onChange,
}: {
	flow: Flow;
	node: CallNode;
	each: CallEach;
	onChange: (source: ListSource) => void;
}) {
	const id = useId();
	const commandTools = useCommandToolField(node);
	const { source } = each;
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
				<TemplateField
					id={`${id}-command`}
					language="bash"
					label="Source command"
					hint="A shell command that prints the list as JSON, for example cat tasks.json."
					flow={flow}
					nodeId={node.id}
					value={source.command}
					invalid={source.command.trim() === ""}
					error={commandTools.error}
					tools={commandTools.tools}
					className="min-h-16"
					placeholder="cat tasks.json"
					action={<CommandSuggest node={node} />}
					onChange={(command) => onChange({ kind: "command", command })}
				/>
			);
	}
}

/**
 * The input of the called flow that takes the element: a pick among its
 * inputs (JSON ones first), or free text while the flow is not picked.
 */
function AsField({
	id,
	node,
	each,
	called,
	onChange,
}: {
	id: string;
	node: CallNode;
	each: CallEach;
	called: Flow | null;
	onChange: (as: string) => void;
}) {
	const inputs = called
		? [...called.inputs].sort(
				(a, b) => Number(b.type === "json") - Number(a.type === "json"),
			)
		: [];
	const picked = inputs.find((input) => input.name === each.as);
	const missing = called !== null && !picked;
	const hint =
		picked?.type === "text"
			? "A text input gets the item as text. Use a json input to read its fields."
			: `The called flow gets the item in this input, and reads it as {{${each.as}}} or {{${each.as}.title}}.`;

	return (
		<Field
			id={id}
			label="Item goes to input"
			hint={hint}
			error={
				missing
					? `${node.flow} has no input ${each.as}. Pick one, or add a json input to it.`
					: null
			}
		>
			{called && inputs.length > 0 ? (
				<NativeSelect
					id={id}
					value={each.as}
					className="font-mono"
					aria-invalid={missing}
					aria-describedby={`${id}-hint`}
					onChange={(event) => onChange(event.target.value)}
				>
					{missing ? (
						<NativeSelectOption value={each.as}>
							{each.as} (missing)
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
					value={each.as}
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
					{each.as} is a text input.
				</p>
			) : null}
		</Field>
	);
}

/** The outcomes that stop the loop, with the called flow's own ones as suggestions. */
function HaltOnField({
	id,
	node,
	each,
	called,
	onChange,
}: {
	id: string;
	node: CallNode;
	each: CallEach;
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
	].filter((name) => !each.haltOn.includes(name));

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
				options={each.haltOn.map((name) => ({ name }))}
				min={0}
				newName="halt"
				describedBy={`${id}-hint`}
				onRename={(index, name) => {
					onChange(each.haltOn.map((old, at) => (at === index ? name : old)));
					return null;
				}}
				onAdd={(option) => onChange([...each.haltOn, option.name])}
				onRemove={(index) =>
					onChange(each.haltOn.filter((_, at) => at !== index))
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
							onClick={() => onChange([...each.haltOn, name])}
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
