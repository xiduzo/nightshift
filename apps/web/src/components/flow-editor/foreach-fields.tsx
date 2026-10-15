import {
	type Flow,
	type ForEachNode,
	flowNameSchema,
	type ItemSource,
} from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import { Checkbox } from "@nightshift/ui/components/checkbox";
import { Input } from "@nightshift/ui/components/input";
import { Label } from "@nightshift/ui/components/label";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { ExternalLinkIcon, PlusIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { emptySource } from "@/lib/flow-draft";

import { Field, PositiveIntInput } from "./fields";
import { OptionsEditor } from "./options-editor";
import { TemplateField } from "./template-field";

/** What the For Each inspector needs from the editor around it. */
export type BodyFlowSupport = {
	/** The name of the flow open in the editor. */
	flowName: string;
	/** The project's other flow files, by name. Undefined while they load. */
	flows: Readonly<Record<string, Flow | null>> | undefined;
	/** Opens a flow of the project in the editor. */
	onOpen: (name: string) => void;
	/** Creates a body flow, points the node at it, and opens it. */
	onCreate: (nodeId: string, name: string) => void;
	creating: boolean;
};

const ITEM_SHAPE = "{ id, title, body?, url?, blockedBy?: id[], done? }";

export function ForEachFields({
	flow,
	node,
	support,
	onChange,
}: {
	flow: Flow;
	node: ForEachNode;
	support: BodyFlowSupport;
	onChange: (change: (node: ForEachNode) => ForEachNode) => void;
}) {
	const id = useId();
	// Switching the source kind back and forth keeps what was typed.
	const lastSource = useRef<Partial<Record<ItemSource["kind"], ItemSource>>>(
		{},
	);
	const setSource = (source: ItemSource) =>
		onChange((current) => ({ ...current, source }));

	const body = node.flow ? support.flows?.[node.flow] : undefined;

	return (
		<>
			<Field
				id={`${id}-kind`}
				label="Items from"
				hint="Read again before each item, so items added during the run get built too. Items wait for their blockers."
			>
				<NativeSelect
					id={`${id}-kind`}
					value={node.source.kind}
					aria-describedby={`${id}-kind-hint`}
					onChange={(event) => {
						const kind = event.target.value as ItemSource["kind"];
						if (kind === node.source.kind) return;
						lastSource.current[node.source.kind] = node.source;
						setSource(lastSource.current[kind] ?? emptySource(kind));
					}}
				>
					<NativeSelectOption value="github">
						GitHub sub-issues
					</NativeSelectOption>
					<NativeSelectOption value="command">A command</NativeSelectOption>
				</NativeSelect>
			</Field>

			{node.source.kind === "github" ? (
				<GitHubSourceFields
					flow={flow}
					source={node.source}
					onChange={(source) => setSource(source)}
				/>
			) : (
				<TemplateField
					id={`${id}-command`}
					label="Source command"
					hint={
						<>
							Runs with sh -c in the worktree and prints a JSON array of items:{" "}
							<code className="font-mono">{ITEM_SHAPE}</code>.
						</>
					}
					flow={flow}
					nodeId={node.id}
					value={node.source.command}
					invalid={node.source.command.trim() === ""}
					className="min-h-16"
					placeholder="cat traces.json"
					onChange={(command) => setSource({ kind: "command", command })}
				/>
			)}

			<BodyFlowField
				id={`${id}-body`}
				node={node}
				support={support}
				onPick={(name) => onChange((current) => ({ ...current, flow: name }))}
			/>

			<div className="flex items-start gap-2">
				<Checkbox
					id={`${id}-branch`}
					checked={node.branchPerItem}
					className="mt-0.5"
					aria-describedby={`${id}-branch-hint`}
					onCheckedChange={(checked) =>
						onChange((current) => ({ ...current, branchPerItem: checked }))
					}
				/>
				<div className="flex flex-col gap-0.5">
					<Label htmlFor={`${id}-branch`}>Branch per item</Label>
					<p id={`${id}-branch-hint`} className="text-muted-foreground text-xs">
						{node.branchPerItem
							? "Each item gets its own branch, on top of the last item that finished: a stack."
							: "All items work on the run's branch, one after the other."}
					</p>
				</div>
			</div>

			<HaltOnField
				id={`${id}-halt`}
				node={node}
				body={body ?? null}
				onChange={(haltOn) => onChange((current) => ({ ...current, haltOn }))}
			/>

			<Field
				id={`${id}-max`}
				label="Max items"
				optional
				hint="A safety net: the most items one visit may start."
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

			<p className="text-muted-foreground text-xs">
				Ends with <span className="text-foreground">done</span> when no item is
				left to start, or <span className="text-foreground">halted</span>. A
				failed item blocks the items that wait on it. Later nodes read{" "}
				<code className="font-mono">{`{{${node.id}.summary}}`}</code> and{" "}
				<code className="font-mono">{`{{${node.id}.done_count}}`}</code>.
			</p>
		</>
	);
}

function GitHubSourceFields({
	flow,
	source,
	onChange,
}: {
	flow: Flow;
	source: Extract<ItemSource, { kind: "github" }>;
	onChange: (source: Extract<ItemSource, { kind: "github" }>) => void;
}) {
	const id = useId();
	const inBody = flow.input === "item";
	const params = inBody ? [] : (flow.params ?? []);
	return (
		<>
			<Field
				id={`${id}-parent`}
				label="Parent issue"
				hint={
					inBody ? (
						<>
							The issue whose sub-issues become the items.{" "}
							<code className="font-mono">{"{{item.number}}"}</code> reads the
							current item of this body flow: the Traces of a Feature.{" "}
							<code className="font-mono">{"{{params.<name>}}"}</code> reads the
							run parameters of the top-level flow.
						</>
					) : params.length > 0 ? (
						<>
							The issue number whose sub-issues become the items, for example an
							Epic. Takes templates, such as{" "}
							{params.map((param, index) => (
								<span key={param.name}>
									{index > 0 ? ", " : null}
									<code className="font-mono">{`{{params.${param.name}}}`}</code>
								</span>
							))}
							.
						</>
					) : (
						"The issue number whose sub-issues become the items, for example an Epic. Takes templates."
					)
				}
			>
				<Input
					id={`${id}-parent`}
					value={source.parent}
					placeholder={
						inBody
							? "{{item.number}}"
							: params[0]
								? `{{params.${params[0].name}}}`
								: "42"
					}
					className="font-mono"
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
				hint="Only sub-issues with this label become items."
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
				hint="Sub-issues with any of these labels are left out. Items they block wait. Separate with commas."
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

/** Picks the body flow among the project's flows with `input: "item"`, or creates one. */
function BodyFlowField({
	id,
	node,
	support,
	onPick,
}: {
	id: string;
	node: ForEachNode;
	support: BodyFlowSupport;
	onPick: (name: string) => void;
}) {
	const [creating, setCreating] = useState(false);
	const { flows } = support;
	const bodies = flows
		? Object.entries(flows)
				.filter(
					([name, flow]) => name !== support.flowName && flow?.input === "item",
				)
				.map(([name]) => name)
				.sort()
		: [];
	const current = node.flow;
	const known = current !== "" && bodies.includes(current);
	const problem =
		current === "" || !flows
			? null
			: current === support.flowName
				? "a For Each cannot run its own flow"
				: !(current in flows)
					? "no such flow"
					: flows[current] === null
						? "does not load"
						: "not a body flow";

	return (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor={id}>Body flow</Label>
			<div className="flex items-center gap-1">
				<NativeSelect
					id={id}
					value={current}
					disabled={!flows}
					aria-invalid={current === "" || (!known && flows !== undefined)}
					aria-describedby={`${id}-hint`}
					onChange={(event) => onPick(event.target.value)}
				>
					<NativeSelectOption value="">
						{flows ? "Pick a body flow" : "Loading flows…"}
					</NativeSelectOption>
					{bodies.map((name) => (
						<NativeSelectOption key={name} value={name}>
							{name}
						</NativeSelectOption>
					))}
					{current !== "" && !known ? (
						<NativeSelectOption value={current}>
							{problem ? `${current} (${problem})` : current}
						</NativeSelectOption>
					) : null}
				</NativeSelect>
				<Button
					variant="outline"
					size="icon-sm"
					disabled={!known}
					aria-label={known ? `Open ${current}` : "Open the body flow"}
					title={known ? `Open ${current}` : "Pick a body flow first"}
					onClick={() => support.onOpen(current)}
				>
					<ExternalLinkIcon />
				</Button>
			</div>
			<p id={`${id}-hint`} className="text-muted-foreground text-xs">
				Runs once per item. A body flow is a flow file marked as one; its
				templates read the item:{" "}
				<code className="font-mono">{"{{item.title}}"}</code>,{" "}
				<code className="font-mono">{"{{item.body}}"}</code>, …
				{flows && bodies.length === 0 ? " This project has none yet." : ""}
			</p>
			{creating ? (
				<NewBodyFlowForm
					taken={flows ? Object.keys(flows) : []}
					suggestion={`${support.flowName}-${node.id}`.replace(/_/g, "-")}
					reserved={support.flowName}
					pending={support.creating}
					onCancel={() => setCreating(false)}
					onCreate={(name) => support.onCreate(node.id, name)}
				/>
			) : (
				<Button
					variant="outline"
					size="xs"
					className="self-start"
					disabled={!flows}
					onClick={() => setCreating(true)}
				>
					<PlusIcon data-icon="inline-start" />
					New body flow
				</Button>
			)}
		</div>
	);
}

function NewBodyFlowForm({
	taken,
	suggestion,
	reserved,
	pending,
	onCancel,
	onCreate,
}: {
	taken: string[];
	suggestion: string;
	reserved: string;
	pending: boolean;
	onCancel: () => void;
	onCreate: (name: string) => void;
}) {
	const id = useId();
	const [name, setName] = useState(() =>
		flowNameSchema.safeParse(suggestion).success ? suggestion : "",
	);
	const trimmed = name.trim();
	const parsed = flowNameSchema.safeParse(trimmed);
	const error =
		trimmed === ""
			? null
			: !parsed.success
				? (parsed.error.issues[0]?.message ?? "Not a valid name.")
				: taken.includes(trimmed) || trimmed === reserved
					? "A flow with this name exists."
					: null;
	const canCreate = trimmed !== "" && error === null && !pending;

	return (
		<div className="flex flex-col gap-1.5 border bg-muted/30 p-2">
			<Label htmlFor={`${id}-name`}>New body flow name</Label>
			<div className="flex items-start gap-1">
				<Input
					id={`${id}-name`}
					value={name}
					className="h-7 font-mono"
					autoComplete="off"
					spellCheck={false}
					aria-invalid={error !== null}
					aria-describedby={`${id}-hint`}
					autoFocus
					onChange={(event) => setName(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							if (canCreate) onCreate(trimmed);
						} else if (event.key === "Escape") {
							onCancel();
						}
					}}
				/>
				<Button
					size="sm"
					disabled={!canCreate}
					onClick={() => onCreate(trimmed)}
				>
					{pending ? "Creating…" : "Create"}
				</Button>
				<Button variant="ghost" size="sm" onClick={onCancel}>
					Cancel
				</Button>
			</div>
			<p
				id={`${id}-hint`}
				role={error ? "alert" : undefined}
				className={
					error ? "text-destructive text-xs" : "text-muted-foreground text-xs"
				}
			>
				{error ??
					"Creates the file with one Agent node that works on the item, saves this flow, and opens the new one."}
			</p>
		</div>
	);
}

/** The labels and choices that stop the loop, with the body's own ones as suggestions. */
function HaltOnField({
	id,
	node,
	body,
	onChange,
}: {
	id: string;
	node: ForEachNode;
	/** The body flow, when it loads. */
	body: Flow | null;
	onChange: (haltOn: string[]) => void;
}) {
	const suggestions = [
		...new Set(
			(body?.nodes ?? []).flatMap((bodyNode) =>
				bodyNode.type === "decision"
					? bodyNode.labels.map((label) => label.name)
					: bodyNode.type === "gate"
						? bodyNode.choices.map((choice) => choice.name)
						: [],
			),
		),
	].filter((name) => !node.haltOn.includes(name));

	return (
		<section
			aria-labelledby={`${id}-heading`}
			className="flex flex-col gap-1.5"
		>
			<h3 id={`${id}-heading`} className="text-xs leading-none">
				Halt on
			</h3>
			<p id={`${id}-hint`} className="text-muted-foreground text-xs">
				A body that ends on one of these Decision labels or Gate choices stops
				the loop with halted.
			</p>
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
				<p className="flex flex-wrap items-center gap-1 text-muted-foreground text-xs">
					From the body:
					{suggestions.map((name) => (
						<button
							key={name}
							type="button"
							className="border bg-background px-1 font-mono text-[11px] outline-none hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring"
							title={`Halt on ${name}`}
							onClick={() => onChange([...node.haltOn, name])}
						>
							+ {name}
						</button>
					))}
				</p>
			) : null}
		</section>
	);
}
