import type { Flow, ForEachNode, ListSource } from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
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
import { PlusIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import {
	calledFlow,
	emptySource,
	nodeOptions,
	SOURCE_KINDS,
} from "@/lib/flow-draft";

import {
	CalledFlowField,
	type CalledFlowSupport,
	InputBindings,
} from "./called-flow-fields";
import { Field, InspectorSection, Note, PositiveIntInput } from "./fields";
import { OptionsEditor } from "./options-editor";
import { TemplateField } from "./template-field";

const SOURCE_ORDER: ListSource["kind"][] = [
	"json",
	"command",
	"files",
	"github",
];

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
			<InspectorSection title="Elements">
				<Field
					id={`${id}-kind`}
					label="Elements from"
					hint="Read again before each element, so elements added during the run run too. An element is any JSON value; an object may carry id, title, url, dependsOn and done."
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

			<InspectorSection title="Each element runs">
				<CalledFlowField
					id={`${id}-flow`}
					node={node}
					support={support}
					hint="Runs once per element. Any flow of the project; the element goes to one of its inputs."
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
							? "Each element gets its own branch, on top of the last element that finished: a stack. Read it as {{run.branch}} and {{run.base_branch}}."
							: "All elements work on the branch that is checked out, one after the other."
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
							A branch per element (a stack)
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
					hint="A safety net: the most elements one visit may start."
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
					Ends with <span className="text-foreground">done</span> when no
					element is left to start, or{" "}
					<span className="text-foreground">halted</span>. A failed element
					blocks the elements that depend on it. Later nodes read{" "}
					<code>{`{{${node.id}.summary}}`}</code>,{" "}
					<code>{`{{${node.id}.done_count}}`}</code>, and each element's result
					in <code>{`{{${node.id}.results}}`}</code>.
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
							A JSON array, e.g.{" "}
							<code className="font-mono">{"{{planner.data.tasks}}"}</code>, or
							the array itself.
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
					label="Source command"
					hint="Runs with sh -c in the worktree and prints a JSON array on stdout."
					flow={flow}
					nodeId={node.id}
					value={source.command}
					invalid={source.command.trim() === ""}
					className="min-h-16"
					variablesOpen={false}
					placeholder="cat tasks.json"
					onChange={(command) => onChange({ kind: "command", command })}
				/>
			);
		case "files":
			return (
				<TemplateField
					id={`${id}-glob`}
					label="Glob"
					hint={
						<>
							Files in the worktree that match, sorted by path. Each element is{" "}
							<code className="font-mono">{"{ id, title, path }"}</code>: read{" "}
							<code className="font-mono">{`{{${node.as}.path}}`}</code>.
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
		case "github":
			return (
				<GitHubSourceFields flow={flow} source={source} onChange={onChange} />
			);
	}
}

function GitHubSourceFields({
	flow,
	source,
	onChange,
}: {
	flow: Flow;
	source: Extract<ListSource, { kind: "github" }>;
	onChange: (source: Extract<ListSource, { kind: "github" }>) => void;
}) {
	const id = useId();
	const inputs = flow.inputs;
	const example = inputs[0]
		? inputs[0].type === "json"
			? `{{${inputs[0].name}.number}}`
			: `{{${inputs[0].name}}}`
		: "42";
	return (
		<>
			<Field
				id={`${id}-parent`}
				label="Parent issue"
				hint={
					<>
						The issue number whose sub-issues become the elements. Takes
						templates, such as <code className="font-mono">{example}</code>.
						Each element holds the sub-issue:{" "}
						<code className="font-mono">
							number, title, body, url, labels, parent
						</code>
						; its "blocked by" links order the list.
					</>
				}
			>
				<Input
					id={`${id}-parent`}
					value={source.parent}
					placeholder={example}
					className="font-mono text-xs"
					autoComplete="off"
					spellCheck={false}
					aria-invalid={source.parent.trim() === ""}
					aria-describedby={`${id}-parent-hint`}
					onChange={(event) =>
						onChange({ ...source, parent: event.target.value })
					}
				/>
			</Field>
			<Field
				id={`${id}-label`}
				label="Required label"
				optional
				hint="Only sub-issues with this label become elements."
			>
				<Input
					id={`${id}-label`}
					value={source.requireLabel ?? ""}
					placeholder="trace"
					className="font-mono"
					autoComplete="off"
					spellCheck={false}
					aria-describedby={`${id}-label-hint`}
					onChange={(event) => {
						const requireLabel = event.target.value.trim();
						onChange({ ...source, requireLabel: requireLabel || undefined });
					}}
				/>
			</Field>
			<Field
				id={`${id}-done`}
				label="Done labels"
				optional
				hint="Sub-issues with any of these labels count as done before the run, like closed ones. Separate with commas."
			>
				<ListInput
					id={`${id}-done`}
					values={source.doneLabels}
					placeholder="done, shipped"
					describedBy={`${id}-done-hint`}
					onChange={(doneLabels) => onChange({ ...source, doneLabels })}
				/>
			</Field>
			<Field
				id={`${id}-skip`}
				label="Skip labels"
				optional
				hint="Sub-issues with any of these labels are left out. Elements that depend on them wait. Separate with commas."
			>
				<ListInput
					id={`${id}-skip`}
					values={source.skipLabels ?? []}
					placeholder="draft"
					describedBy={`${id}-skip-hint`}
					onChange={(skipLabels) => onChange({ ...source, skipLabels })}
				/>
			</Field>
		</>
	);
}

function parseList(text: string): string[] {
	return text
		.split(",")
		.map((part) => part.trim())
		.filter((part) => part !== "");
}

/** A comma-separated list. Keeps what the person types; commits the parsed list. */
function ListInput({
	id,
	values,
	placeholder,
	describedBy,
	onChange,
}: {
	id: string;
	values: string[];
	placeholder?: string;
	describedBy?: string;
	onChange: (values: string[]) => void;
}) {
	const [text, setText] = useState(values.join(", "));

	// Follow outside changes, but keep a half-typed list that means the same.
	useEffect(() => {
		setText((current) =>
			parseList(current).join("\u0000") === values.join("\u0000")
				? current
				: values.join(", "),
		);
	}, [values]);

	return (
		<Input
			id={id}
			value={text}
			placeholder={placeholder}
			className="font-mono"
			autoComplete="off"
			spellCheck={false}
			aria-describedby={describedBy}
			onChange={(event) => {
				setText(event.target.value);
				onChange(parseList(event.target.value));
			}}
		/>
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
			? "A text input gets the element as JSON text. A json input keeps its fields."
			: `The input of the called flow that receives the element. That flow reads it as {{${node.as}}} or {{${node.as}.title}}.`;

	return (
		<Field
			id={id}
			label="Element goes to input"
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
				calledNode.type === "decision" ||
				calledNode.type === "gate" ||
				calledNode.type === "agent"
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
				A called flow that ends on one of these outcomes stops the loop with
				halted.
			</FieldDescription>
			<OptionsEditor
				kind="label"
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
