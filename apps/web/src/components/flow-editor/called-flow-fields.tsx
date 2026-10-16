import {
	type Flow,
	type ForEachNode,
	flowNameSchema,
	type SubflowNode,
} from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import { Input } from "@nightshift/ui/components/input";
import { Label } from "@nightshift/ui/components/label";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { ExternalLinkIcon, PlusIcon, XIcon } from "lucide-react";
import { useId, useState } from "react";

import type { ProjectFlowMap } from "@/lib/flow-draft";

import { TemplateField } from "./template-field";

/** What a Subflow or For Each inspector needs from the editor around it. */
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

/** Picks the flow a Subflow or For Each node calls, among all the project's flows, or creates one. */
export function CalledFlowField({
	id,
	node,
	support,
	hint,
	onPick,
}: {
	id: string;
	node: SubflowNode | ForEachNode;
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
						? "does not load"
						: null;

	return (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor={id}>Flow to run</Label>
			<div className="flex items-center gap-1">
				<NativeSelect
					id={id}
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
							{flows?.[name] === null ? `${name} (does not load)` : name}
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
			<p id={`${id}-hint`} className="text-muted-foreground text-xs">
				{hint}
				{flows && names.length === 0
					? " This project has no other flow yet."
					: ""}
			</p>
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
				<Button
					variant="outline"
					size="xs"
					className="self-start"
					disabled={!flows}
					onClick={() => setCreating(true)}
				>
					<PlusIcon data-icon="inline-start" />
					New flow
				</Button>
			)}
		</div>
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
		<div className="flex flex-col gap-1.5 border bg-muted/30 p-2">
			<Label htmlFor={`${id}-name`}>New flow name</Label>
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
					"Creates the file with one Agent node, saves this flow, and opens the new one."}
			</p>
		</div>
	);
}

/**
 * A template per input of the called flow. `skip` is the input a For Each
 * binds to the element. A binding to a name the flow does not take shows
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
	node: SubflowNode | ForEachNode;
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
		<section aria-labelledby={`${id}-heading`} className="flex flex-col gap-3">
			<div className="flex flex-col gap-0.5">
				<h3 id={`${id}-heading`} className="text-xs leading-none">
					{skip ? "Other inputs" : "Inputs"} of{" "}
					<span className="font-mono">{node.flow}</span>
				</h3>
				<p className="text-muted-foreground text-xs">
					{inputs.length === 0
						? skip
							? "It takes no other input."
							: "It takes no input."
						: "A template per input. Empty takes the input's default."}
				</p>
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
				<div
					key={name}
					className="flex items-center gap-2 border border-status-interrupted/40 bg-status-interrupted/10 px-2 py-1 text-xs"
				>
					<span className="min-w-0 flex-1">
						<span className="font-mono">{name}</span>{" "}
						{name === skip
							? "is bound to the element; this binding is ignored."
							: `is not an input of ${node.flow}.`}
					</span>
					<Button
						variant="ghost"
						size="icon-xs"
						aria-label={`Remove the binding ${name}`}
						title="Remove this binding"
						onClick={() => set(name, "")}
					>
						<XIcon />
					</Button>
				</div>
			))}
		</section>
	);
}
