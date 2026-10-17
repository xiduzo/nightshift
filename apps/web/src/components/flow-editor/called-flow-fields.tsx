import { type CallNode, type Flow, flowNameSchema } from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
	FieldLegend,
	FieldSet,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemMedia,
} from "@nightshift/ui/components/item";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { Spinner } from "@nightshift/ui/components/spinner";
import {
	ExternalLinkIcon,
	PlusIcon,
	TriangleAlertIcon,
	XIcon,
} from "lucide-react";
import { useId, useState } from "react";

import type { ProjectFlowMap } from "@/lib/flow-draft";

import { TemplateField } from "./template-field";

/** What a Call node's inspector needs from the editor around it. */
export type CalledFlowSupport = {
	/** The name of the flow open in the editor. */
	flowName: string;
	/** The project's other flow files, by name. Undefined while they load. */
	flows: ProjectFlowMap | undefined;
	/** Opens a flow of the project in the editor. */
	onOpen: (name: string) => void;
	/** Creates a flow for the node, points the node at it, and opens it. */
	onCreate: (nodeId: string, name: string) => void;
	creating: boolean;
};

/** Picks the flow a Call node calls, among all the project's flows, or creates one. */
export function CalledFlowField({
	id,
	node,
	support,
	hint,
	onPick,
}: {
	id: string;
	node: CallNode;
	support: CalledFlowSupport;
	hint: string;
	onPick: (name: string) => void;
}) {
	const [creating, setCreating] = useState(false);
	const { flows } = support;
	const names = flows
		? Object.keys(flows)
				.filter((name) => name !== support.flowName)
				.sort()
		: [];
	const current = node.flow;
	const known = current !== "" && names.includes(current);
	const problem =
		current === "" || !flows
			? null
			: current === support.flowName
				? "this flow itself"
				: !(current in flows)
					? "no such flow"
					: flows[current] === null
						? "not valid"
						: null;

	return (
		<Field className="gap-2" data-invalid={problem !== null ? true : undefined}>
			<FieldLabel htmlFor={id}>Flow to run</FieldLabel>
			<div className="flex items-center gap-2">
				<NativeSelect
					id={id}
					className="min-w-0 flex-1 font-mono"
					value={current}
					disabled={!flows}
					aria-invalid={current === "" || problem !== null}
					aria-describedby={`${id}-hint`}
					onChange={(event) => onPick(event.target.value)}
				>
					<NativeSelectOption value="">
						{flows ? "Pick a flow" : "Loading flows…"}
					</NativeSelectOption>
					{names.map((name) => (
						<NativeSelectOption key={name} value={name}>
							{flows?.[name] === null ? `${name} (not valid)` : name}
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
					aria-label={known ? `Open ${current}` : "Open the flow"}
					title={known ? `Open ${current}` : "Pick a flow first"}
					onClick={() => support.onOpen(current)}
				>
					<ExternalLinkIcon />
				</Button>
			</div>
			<FieldDescription id={`${id}-hint`} className="text-xs">
				{hint}
				{flows && names.length === 0
					? " This project has no other flow yet."
					: ""}
			</FieldDescription>
			{creating ? (
				<NewFlowForm
					taken={flows ? Object.keys(flows) : []}
					suggestion={`${support.flowName}-${node.id}`.replace(/_/g, "-")}
					reserved={support.flowName}
					pending={support.creating}
					onCancel={() => setCreating(false)}
					onCreate={(name) => support.onCreate(node.id, name)}
				/>
			) : (
				<div>
					<Button
						variant="outline"
						size="sm"
						disabled={!flows}
						onClick={() => setCreating(true)}
					>
						<PlusIcon data-icon="inline-start" />
						New flow
					</Button>
				</div>
			)}
		</Field>
	);
}

function NewFlowForm({
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
		<FieldSet className="gap-2 rounded-lg border border-dashed bg-muted/30 p-3">
			<FieldLegend className="sr-only">New flow</FieldLegend>
			<FieldLabel htmlFor={`${id}-name`}>New flow name</FieldLabel>
			<div className="flex items-start gap-1.5">
				<Input
					id={`${id}-name`}
					value={name}
					className="h-8 min-w-0 flex-1 font-mono text-xs"
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
					{pending ? <Spinner data-icon="inline-start" /> : null}
					{pending ? "Creating…" : "Create"}
				</Button>
				<Button variant="ghost" size="sm" onClick={onCancel}>
					Cancel
				</Button>
			</div>
			{error ? (
				<FieldError id={`${id}-hint`} className="text-xs">
					{error}
				</FieldError>
			) : (
				<FieldDescription id={`${id}-hint`} className="text-xs">
					Saves this flow, then opens the new flow with one Agent node in it.
				</FieldDescription>
			)}
		</FieldSet>
	);
}

/**
 * A template per input of the called flow. `skip` is the input a Call with
 * `each` binds to the element. A binding to a name the flow does not take shows
 * with a way to drop it.
 */
export function InputBindings({
	flow,
	node,
	called,
	skip,
	onChange,
}: {
	flow: Flow;
	node: CallNode;
	/** The called flow, when it loads. */
	called: Flow | null;
	skip?: string;
	onChange: (bindings: Record<string, string>) => void;
}) {
	const id = useId();
	const bindings = node.inputs;
	const inputs = (called?.inputs ?? []).filter((input) => input.name !== skip);
	const declared = new Set(called?.inputs.map((input) => input.name) ?? []);
	const stray = called
		? Object.keys(bindings).filter(
				(name) => !declared.has(name) || name === skip,
			)
		: [];

	const set = (name: string, value: string) => {
		const next = { ...bindings };
		if (value === "") delete next[name];
		else next[name] = value;
		onChange(next);
	};

	if (!called) return null;

	return (
		<FieldSet className="gap-4">
			<div className="flex flex-col gap-1">
				<FieldLegend variant="label" className="mb-0">
					{skip ? "Other inputs" : "Inputs"} of{" "}
					<span className="font-mono">{node.flow}</span>
				</FieldLegend>
				<FieldDescription className="text-xs">
					{inputs.length === 0
						? skip
							? "It takes no other input."
							: "It takes no input."
						: "Fill in each input. Leave one empty to use its default."}
				</FieldDescription>
			</div>
			{inputs.map((input) => {
				const value = bindings[input.name] ?? "";
				const missing =
					input.required === true && !input.default && value.trim() === "";
				return (
					<TemplateField
						key={input.name}
						id={`${id}-${input.name}`}
						label={
							<span className="flex min-w-0 items-center gap-1.5">
								<span className="font-mono">{input.name}</span>
								<span className="font-normal text-muted-foreground">
									{input.type}
								</span>
							</span>
						}
						required={input.required === true}
						hint={
							[
								input.description ?? input.label,
								input.default ? `Default: ${input.default}` : null,
							]
								.filter(Boolean)
								.join(" · ") || undefined
						}
						flow={flow}
						nodeId={node.id}
						value={value}
						invalid={missing}
						multiline={false}
						variablesOpen={false}
						placeholder={
							input.default ?? (input.type === "json" ? "{{plan.data}}" : "")
						}
						onChange={(next) => set(input.name, next)}
					/>
				);
			})}
			{stray.map((name) => (
				<Item
					key={name}
					variant="outline"
					size="xs"
					className="flex-nowrap border-status-waiting/40 bg-status-waiting/10"
				>
					<ItemMedia variant="icon" className="text-status-waiting">
						<TriangleAlertIcon aria-hidden="true" />
					</ItemMedia>
					<ItemContent className="text-xs">
						<span>
							<span className="font-mono">{name}</span>{" "}
							{name === skip
								? "already gets the item. This value is not used."
								: `is not an input of ${node.flow}.`}
						</span>
					</ItemContent>
					<ItemActions>
						<Button
							variant="ghost"
							size="icon-xs"
							aria-label={`Remove the value for ${name}`}
							title="Remove this value"
							onClick={() => set(name, "")}
						>
							<XIcon />
						</Button>
					</ItemActions>
				</Item>
			))}
		</FieldSet>
	);
}
