import {
	type AgentNode,
	type CommandNode,
	type DecisionNode,
	type Flow,
	type FlowNode,
	type GateNode,
	nodeIdSchema,
	type SubflowNode,
} from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import { Input } from "@nightshift/ui/components/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { Textarea } from "@nightshift/ui/components/textarea";
import { PlayIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import { useId, useState } from "react";

import { NODE_TYPE } from "@/components/flow/node-type";
import type { Effort, PermissionMode } from "@/lib/api-types";
import {
	calledFlow,
	MODEL_SUGGESTIONS,
	type NodeOption,
	nodeOptions,
	type OptionNode,
	withOptions,
} from "@/lib/flow-draft";
import {
	HARNESSES,
	type HarnessName,
	harnessInfo,
	switchHarness,
} from "@/lib/harnesses";

import {
	CalledFlowField,
	type CalledFlowSupport,
	InputBindings,
} from "./called-flow-fields";
import { Field, PositiveIntInput } from "./fields";
import { ForEachFields } from "./foreach-fields";
import { McpServersField } from "./mcp-servers-field";
import { OptionsEditor } from "./options-editor";
import { OutputSchemaField } from "./output-schema-field";
import { TemplateField } from "./template-field";
import { ToolSetsField } from "./tool-sets-field";

const PERMISSION_MODES: { value: PermissionMode; label: string }[] = [
	{ value: "auto", label: "Auto (approves safe actions, for nights)" },
	{ value: "acceptEdits", label: "Accept edits (no shell commands)" },
	{ value: "default", label: "Ask for each tool" },
	{ value: "plan", label: "Plan only" },
	{ value: "bypassPermissions", label: "Bypass permissions" },
];

const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

export function NodeInspector({
	flow,
	node,
	onChange,
	onRename,
	onRenameOutcome,
	onRemoveOutcome,
	onSetAgentOutcomes,
	onSetStart,
	onDelete,
	calledFlows,
}: {
	flow: Flow;
	node: FlowNode;
	/** Subflow and For Each nodes: the project's flows and the actions on them. */
	calledFlows: CalledFlowSupport;
	onChange: (change: (node: FlowNode) => FlowNode) => void;
	/** Returns an error message when the new id is taken. */
	onRename: (id: string) => string | null;
	/** Renames a Decision label, Gate choice or Agent outcome and moves its edges along. */
	onRenameOutcome: (index: number, name: string) => string | null;
	/** Removes a Decision label, Gate choice or Agent outcome and drops its edges. */
	onRemoveOutcome: (index: number) => void;
	/** Gives an Agent node its own outcomes, or back the standard ones; drops edges that no longer fit. */
	onSetAgentOutcomes: (outcomes: NodeOption[] | undefined) => void;
	onSetStart: () => void;
	onDelete: () => void;
}) {
	const id = useId();
	const isStart = flow.start === node.id;
	const { label: typeLabel, icon: Icon } = NODE_TYPE[node.type];

	return (
		<div className="flex flex-col gap-4">
			<header className="flex items-center gap-2">
				<Icon className="size-4 text-muted-foreground" aria-hidden="true" />
				<h2 className="font-medium text-sm">{typeLabel} node</h2>
				<div className="ml-auto flex items-center gap-1">
					<Button
						variant="outline"
						size="xs"
						onClick={onSetStart}
						disabled={isStart}
						title={isStart ? "The run starts here." : "Start the run here"}
					>
						<PlayIcon data-icon="inline-start" />
						{isStart ? "Start node" : "Set as start"}
					</Button>
					<Button
						variant="destructive"
						size="icon-xs"
						onClick={onDelete}
						aria-label={`Delete ${node.id}`}
						title="Delete node (Backspace)"
					>
						<Trash2Icon />
					</Button>
				</div>
			</header>

			<IdField
				key={node.id}
				id={`${id}-id`}
				nodeId={node.id}
				onRename={onRename}
			/>

			<Field
				id={`${id}-label`}
				label="Label"
				optional
				hint="Shown on the canvas."
			>
				<Input
					id={`${id}-label`}
					value={node.label ?? ""}
					placeholder={node.id}
					autoComplete="off"
					onChange={(event) => {
						const label = event.target.value;
						onChange((current) => ({ ...current, label: label || undefined }));
					}}
				/>
			</Field>

			{node.type === "agent" ? (
				<AgentFields
					flow={flow}
					node={node}
					onChange={(change) =>
						onChange((current) =>
							current.type === "agent" ? change(current) : current,
						)
					}
					onRenameOutcome={onRenameOutcome}
					onRemoveOutcome={onRemoveOutcome}
					onSetOutcomes={onSetAgentOutcomes}
				/>
			) : null}
			{node.type === "command" ? (
				<CommandFields
					node={node}
					onChange={(change) =>
						onChange((current) =>
							current.type === "command" ? change(current) : current,
						)
					}
				/>
			) : null}
			{node.type === "decision" ? (
				<DecisionFields
					flow={flow}
					node={node}
					onChange={(change) =>
						onChange((current) =>
							current.type === "decision" ? change(current) : current,
						)
					}
					onRenameOutcome={onRenameOutcome}
					onRemoveOutcome={onRemoveOutcome}
				/>
			) : null}
			{node.type === "gate" ? (
				<GateFields
					flow={flow}
					node={node}
					onChange={(change) =>
						onChange((current) =>
							current.type === "gate" ? change(current) : current,
						)
					}
					onRenameOutcome={onRenameOutcome}
					onRemoveOutcome={onRemoveOutcome}
				/>
			) : null}

			{node.type === "subflow" ? (
				<SubflowFields
					flow={flow}
					node={node}
					support={calledFlows}
					onChange={(change) =>
						onChange((current) =>
							current.type === "subflow" ? change(current) : current,
						)
					}
				/>
			) : null}

			{node.type === "foreach" ? (
				<ForEachFields
					flow={flow}
					node={node}
					support={calledFlows}
					onChange={(change) =>
						onChange((current) =>
							current.type === "foreach" ? change(current) : current,
						)
					}
				/>
			) : null}

			<Field
				id={`${id}-timeout`}
				label="Timeout in minutes"
				optional
				hint="The step fails when one visit runs longer."
			>
				<PositiveIntInput
					id={`${id}-timeout`}
					value={node.timeoutMinutes}
					placeholder="No limit"
					describedBy={`${id}-timeout-hint`}
					onChange={(timeoutMinutes) =>
						onChange((current) => ({ ...current, timeoutMinutes }))
					}
				/>
			</Field>
		</div>
	);
}

/** Commits on blur or Enter, so the edges follow one rename and not every keystroke. */
function IdField({
	id,
	nodeId,
	onRename,
}: {
	id: string;
	nodeId: string;
	onRename: (id: string) => string | null;
}) {
	const [text, setText] = useState(nodeId);
	const [error, setError] = useState<string | null>(null);

	const commit = () => {
		const next = text.trim();
		if (next === nodeId) {
			setText(nodeId);
			setError(null);
			return;
		}
		const parsed = nodeIdSchema.safeParse(next);
		if (!parsed.success) {
			setError(parsed.error.issues[0]?.message ?? "Not a valid id.");
			return;
		}
		const taken = onRename(next);
		setError(taken);
	};

	return (
		<Field
			id={id}
			label="Id"
			error={error}
			hint={
				<>
					Other nodes read its outputs as{" "}
					<code className="font-mono">{`{{${nodeId}.field}}`}</code>. Renaming
					updates edges, the start, and those references.
				</>
			}
		>
			<Input
				id={id}
				value={text}
				className="font-mono"
				autoComplete="off"
				spellCheck={false}
				aria-invalid={error !== null}
				aria-describedby={`${id}-hint`}
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
						setText(nodeId);
						setError(null);
					}
				}}
			/>
		</Field>
	);
}

function AgentFields({
	flow,
	node,
	onChange,
	onRenameOutcome,
	onRemoveOutcome,
	onSetOutcomes,
}: {
	flow: Flow;
	node: AgentNode;
	onChange: (change: (node: AgentNode) => AgentNode) => void;
	onRenameOutcome: (index: number, name: string) => string | null;
	onRemoveOutcome: (index: number) => void;
	onSetOutcomes: (outcomes: NodeOption[] | undefined) => void;
}) {
	const id = useId();
	const harness = harnessInfo(node.harness);

	return (
		<>
			<Field id={`${id}-harness`} label="Harness" hint={harness.note}>
				<NativeSelect
					id={`${id}-harness`}
					value={node.harness}
					aria-describedby={`${id}-harness-hint`}
					onChange={(event) => {
						const next = event.target.value as HarnessName;
						onChange((current) => switchHarness(current, next));
					}}
				>
					{HARNESSES.map(({ value, label }) => (
						<NativeSelectOption key={value} value={value}>
							{label}
						</NativeSelectOption>
					))}
				</NativeSelect>
			</Field>

			<TemplateField
				id={`${id}-prompt`}
				label="Prompt"
				hint={
					node.skill
						? `Runs as /${node.skill} followed by the prompt.`
						: "What the agent should do. Leave it empty only when a skill is set."
				}
				flow={flow}
				nodeId={node.id}
				value={node.prompt}
				placeholder="Implement the change, then report pass or fail."
				onChange={(prompt) => onChange((current) => ({ ...current, prompt }))}
			/>

			<Field
				id={`${id}-skill`}
				label="Skill"
				optional
				hint={`A skill ${harness.label} already has, without the slash.`}
			>
				<Input
					id={`${id}-skill`}
					value={node.skill ?? ""}
					placeholder="wtf.implement-trace"
					className="font-mono"
					autoComplete="off"
					spellCheck={false}
					aria-describedby={`${id}-skill-hint`}
					onChange={(event) => {
						const skill = event.target.value.replace(/^\//, "").trim();
						onChange((current) => ({ ...current, skill: skill || undefined }));
					}}
				/>
			</Field>

			<div className="grid grid-cols-2 gap-3">
				<Field id={`${id}-model`} label="Model">
					<Input
						id={`${id}-model`}
						list={`${id}-models`}
						value={node.model}
						autoComplete="off"
						spellCheck={false}
						aria-invalid={node.model.trim() === ""}
						onChange={(event) => {
							const model = event.target.value;
							onChange((current) => ({ ...current, model }));
						}}
					/>
					<datalist id={`${id}-models`}>
						{harness.models.map((value) => (
							<option key={value} value={value} />
						))}
					</datalist>
				</Field>
				<Field id={`${id}-effort`} label="Effort">
					<NativeSelect
						id={`${id}-effort`}
						value={node.effort ?? ""}
						onChange={(event) => {
							const effort = (event.target.value || undefined) as
								| Effort
								| undefined;
							onChange((current) => ({ ...current, effort }));
						}}
					>
						<NativeSelectOption value="">Model default</NativeSelectOption>
						{EFFORTS.map((value) => (
							<NativeSelectOption key={value} value={value}>
								{value}
							</NativeSelectOption>
						))}
					</NativeSelect>
				</Field>
			</div>

			<Field id={`${id}-permission`} label="Permission mode">
				<NativeSelect
					id={`${id}-permission`}
					value={node.permissionMode}
					onChange={(event) => {
						const permissionMode = event.target.value as PermissionMode;
						onChange((current) => ({ ...current, permissionMode }));
					}}
				>
					{PERMISSION_MODES.map(({ value, label }) => (
						<NativeSelectOption key={value} value={value}>
							{label}
						</NativeSelectOption>
					))}
				</NativeSelect>
			</Field>
			{node.permissionMode === "bypassPermissions" ? (
				<p className="-mt-2 flex items-start gap-1.5 text-status-interrupted text-xs">
					<TriangleAlertIcon
						className="mt-px size-3.5 shrink-0"
						aria-hidden="true"
					/>
					The agent runs every tool, shell commands included, without asking.
				</p>
			) : null}

			<Field
				id={`${id}-session`}
				label="Session on a later visit"
				hint={
					node.session === "fresh"
						? "A retry starts a new session with only the prompt: a tight brief."
						: "A retry continues this node's last session, with its full context."
				}
			>
				<NativeSelect
					id={`${id}-session`}
					value={node.session}
					aria-describedby={`${id}-session-hint`}
					onChange={(event) => {
						const session = event.target.value as AgentNode["session"];
						onChange((current) => ({ ...current, session }));
					}}
				>
					<NativeSelectOption value="fresh">Fresh session</NativeSelectOption>
					<NativeSelectOption value="resume">
						Resume the last session
					</NativeSelectOption>
				</NativeSelect>
			</Field>

			<Field
				id={`${id}-idle`}
				label="Idle timeout in minutes"
				optional
				hint="The step fails when the agent shows no activity for this long."
			>
				<PositiveIntInput
					id={`${id}-idle`}
					value={node.idleMinutes}
					placeholder="No limit"
					describedBy={`${id}-idle-hint`}
					onChange={(idleMinutes) =>
						onChange((current) => ({ ...current, idleMinutes }))
					}
				/>
			</Field>

			<AgentOutcomesField
				id={`${id}-outcomes`}
				node={node}
				flow={flow}
				onChange={onChange}
				onRenameOutcome={onRenameOutcome}
				onRemoveOutcome={onRemoveOutcome}
				onSetOutcomes={onSetOutcomes}
			/>

			<OutputSchemaField
				id={`${id}-output`}
				nodeId={node.id}
				output={node.output}
				onChange={(output) =>
					onChange(({ output: _, ...rest }) =>
						output === undefined ? rest : { ...rest, output },
					)
				}
			/>

			<ToolSetsField
				id={`${id}-tools`}
				tools={node.tools ?? []}
				onChange={(tools) => onChange((current) => ({ ...current, tools }))}
			/>

			<McpServersField
				id={`${id}-mcp`}
				servers={node.mcpServers}
				onChange={(mcpServers) =>
					onChange(({ mcpServers: _, ...rest }) =>
						mcpServers === undefined ? rest : { ...rest, mcpServers },
					)
				}
			/>

			<p className="text-muted-foreground text-xs">
				Harness: <span className="text-foreground">{harness.label}</span>. The
				agent ends with a step report:{" "}
				{node.outcomes
					? `one of its own outcomes (${node.outcomes.map((o) => o.name).join(", ")})`
					: "pass, fail, or needs input"}
				, a summary
				{node.output ? ", and data that matches the output schema" : ""}.
			</p>
		</>
	);
}

function CommandFields({
	node,
	onChange,
}: {
	node: CommandNode;
	onChange: (change: (node: CommandNode) => CommandNode) => void;
}) {
	const id = useId();
	return (
		<Field
			id={`${id}-command`}
			label="Command"
			hint='Runs with sh -c in the worktree. Exit 0 is pass, anything else is fail. Templates arrive as environment variables, so quote them: echo "{{worker.summary}}".'
		>
			<Textarea
				id={`${id}-command`}
				value={node.command}
				placeholder="bun run check"
				className="min-h-16 font-mono"
				spellCheck={false}
				aria-invalid={node.command.trim() === ""}
				aria-describedby={`${id}-command-hint`}
				onChange={(event) => {
					const command = event.target.value;
					onChange((current) => ({ ...current, command }));
				}}
			/>
		</Field>
	);
}

/** The labels or choices of a node, with the edits that keep its edges in step. */
function NodeOptionsField<T extends OptionNode>({
	id,
	kind,
	node,
	min,
	hint,
	onChange,
	onRenameOutcome,
	onRemoveOutcome,
}: {
	id: string;
	kind: "label" | "choice" | "outcome";
	node: T;
	min: number;
	hint: string;
	onChange: (change: (node: T) => T) => void;
	onRenameOutcome: (index: number, name: string) => string | null;
	onRemoveOutcome: (index: number) => void;
}) {
	const options = nodeOptions(node);
	const change = (edit: (options: NodeOption[]) => NodeOption[]) =>
		onChange((current) => withOptions(current, edit(nodeOptions(current))));

	return (
		<section
			aria-labelledby={`${id}-heading`}
			className="flex flex-col gap-1.5"
		>
			<h3 id={`${id}-heading`} className="text-xs leading-none">
				{kind === "label"
					? "Labels"
					: kind === "choice"
						? "Choices"
						: "Own outcomes"}
			</h3>
			<p id={`${id}-hint`} className="text-muted-foreground text-xs">
				{hint}
			</p>
			<OptionsEditor
				kind={kind}
				options={options}
				min={min}
				describedBy={`${id}-hint`}
				onRename={onRenameOutcome}
				onRemove={onRemoveOutcome}
				onDescribe={(index, description) =>
					change((list) =>
						list.map((option, at) => {
							if (at !== index) return option;
							const { description: _, ...rest } = option;
							return description === undefined
								? rest
								: { ...rest, description };
						}),
					)
				}
				onAdd={(option) => change((list) => [...list, option])}
				onMove={(from, to) =>
					change((list) => {
						const next = list.slice();
						const [moved] = next.splice(from, 1);
						if (moved) next.splice(to, 0, moved);
						return next;
					})
				}
			/>
		</section>
	);
}

function DecisionFields({
	flow,
	node,
	onChange,
	onRenameOutcome,
	onRemoveOutcome,
}: {
	flow: Flow;
	node: DecisionNode;
	onChange: (change: (node: DecisionNode) => DecisionNode) => void;
	onRenameOutcome: (index: number, name: string) => string | null;
	onRemoveOutcome: (index: number) => void;
}) {
	const id = useId();
	return (
		<>
			<TemplateField
				id={`${id}-prompt`}
				label="Prompt"
				hint="What to decide, with the context it needs. The decider reads it, picks one label, and writes notes on why."
				flow={flow}
				nodeId={node.id}
				value={node.prompt}
				invalid={node.prompt.trim() === ""}
				placeholder="Read {{check.log_tail}}. Is the build green enough to open a pull request?"
				onChange={(prompt) => onChange((current) => ({ ...current, prompt }))}
			/>

			<NodeOptionsField
				id={`${id}-labels`}
				kind="label"
				node={node}
				min={2}
				hint="The decider returns exactly one. Each label is an outcome with its own edge. A description tells the decider when to pick it."
				onChange={onChange}
				onRenameOutcome={onRenameOutcome}
				onRemoveOutcome={onRemoveOutcome}
			/>

			<Field
				id={`${id}-model`}
				label="Model"
				hint="A small, fast model is enough to pick a label."
			>
				<Input
					id={`${id}-model`}
					list={`${id}-models`}
					value={node.model}
					autoComplete="off"
					spellCheck={false}
					aria-invalid={node.model.trim() === ""}
					aria-describedby={`${id}-model-hint`}
					onChange={(event) => {
						const model = event.target.value;
						onChange((current) => ({ ...current, model }));
					}}
				/>
				<datalist id={`${id}-models`}>
					{MODEL_SUGGESTIONS.map((value) => (
						<option key={value} value={value} />
					))}
				</datalist>
			</Field>

			<ToolSetsField
				id={`${id}-tools`}
				tools={node.tools ?? []}
				onChange={(tools) => onChange((current) => ({ ...current, tools }))}
			/>

			<p className="text-muted-foreground text-xs">
				Decider: <span className="text-foreground">Claude Code</span>. Later
				nodes read <code className="font-mono">{`{{${node.id}.outcome}}`}</code>{" "}
				and <code className="font-mono">{`{{${node.id}.notes}}`}</code>.
			</p>
		</>
	);
}

function GateFields({
	flow,
	node,
	onChange,
	onRenameOutcome,
	onRemoveOutcome,
}: {
	flow: Flow;
	node: GateNode;
	onChange: (change: (node: GateNode) => GateNode) => void;
	onRenameOutcome: (index: number, name: string) => string | null;
	onRemoveOutcome: (index: number) => void;
}) {
	const id = useId();
	return (
		<>
			<TemplateField
				id={`${id}-question`}
				label="Question"
				hint="What you are asked in the Needs-you inbox, with the context you need to answer. The run waits until you do."
				flow={flow}
				nodeId={node.id}
				value={node.question}
				invalid={node.question.trim() === ""}
				className="font-sans"
				placeholder="The worker opened {{worker.summary}}. Merge it and go on?"
				onChange={(question) =>
					onChange((current) => ({ ...current, question }))
				}
			/>

			<NodeOptionsField
				id={`${id}-choices`}
				kind="choice"
				node={node}
				min={1}
				hint="One button each in the inbox. Each choice is an outcome with its own edge."
				onChange={onChange}
				onRenameOutcome={onRenameOutcome}
				onRemoveOutcome={onRemoveOutcome}
			/>

			<p className="text-muted-foreground text-xs">
				Later nodes read your answer as{" "}
				<code className="font-mono">{`{{${node.id}.outcome}}`}</code> and your
				note as <code className="font-mono">{`{{${node.id}.note}}`}</code>.
			</p>
		</>
	);
}

/**
 * An Agent node reports pass, fail or needs-input, or one of its own
 * outcomes. Each own outcome has a handle; renaming one moves its edges,
 * removing one drops them (with an undo).
 */
function AgentOutcomesField({
	id,
	node,
	flow,
	onChange,
	onRenameOutcome,
	onRemoveOutcome,
	onSetOutcomes,
}: {
	id: string;
	node: AgentNode;
	flow: Flow;
	onChange: (change: (node: AgentNode) => AgentNode) => void;
	onRenameOutcome: (index: number, name: string) => string | null;
	onRemoveOutcome: (index: number) => void;
	onSetOutcomes: (outcomes: NodeOption[] | undefined) => void;
}) {
	if (!node.outcomes) {
		// Keep the edges the node has: seed with the standard outcomes they use.
		const used = new Set(
			flow.edges
				.filter((edge) => edge.from === node.id)
				.map((edge) => edge.outcome),
		);
		const seed: NodeOption[] = [
			{ name: "pass", description: "The work is done." },
			{ name: "fail", description: "The work could not be done." },
			...(used.has("needs-input")
				? [{ name: "needs-input", description: "A person must answer first." }]
				: []),
		];
		return (
			<section
				aria-labelledby={`${id}-heading`}
				className="flex flex-col gap-1.5"
			>
				<h3 id={`${id}-heading`} className="text-xs leading-none">
					Own outcomes
				</h3>
				<p className="text-muted-foreground text-xs">
					The agent reports pass, fail, or needs input. Give it its own
					outcomes, such as approved and changes-requested, each with its own
					edge.
				</p>
				<Button
					variant="outline"
					size="xs"
					className="self-start"
					onClick={() => onSetOutcomes(seed)}
				>
					Use own outcomes
				</Button>
			</section>
		);
	}
	return (
		<div className="flex flex-col gap-1.5">
			<NodeOptionsField
				id={id}
				kind="outcome"
				node={node}
				min={1}
				hint="The agent reports exactly one. Each outcome is a handle with its own edge. A description tells the agent when to pick it."
				onChange={onChange}
				onRenameOutcome={onRenameOutcome}
				onRemoveOutcome={onRemoveOutcome}
			/>
			<Button
				variant="ghost"
				size="xs"
				className="self-start"
				onClick={() => onSetOutcomes(undefined)}
			>
				Back to pass, fail and needs input
			</Button>
		</div>
	);
}

/** The flow a Subflow node calls once, and its inputs bound by templates. */
function SubflowFields({
	flow,
	node,
	support,
	onChange,
}: {
	flow: Flow;
	node: SubflowNode;
	support: CalledFlowSupport;
	onChange: (change: (node: SubflowNode) => SubflowNode) => void;
}) {
	const id = useId();
	const called = calledFlow(node, support.flows);
	const outputs = called?.outputs ?? [];
	return (
		<>
			<CalledFlowField
				id={`${id}-flow`}
				node={node}
				support={support}
				hint="Runs once, in the same worktree, then this node ends with pass (it finished) or fail."
				onPick={(name) => onChange((current) => ({ ...current, flow: name }))}
			/>
			<InputBindings
				flow={flow}
				node={node}
				called={called}
				onChange={(inputs) => onChange((current) => ({ ...current, inputs }))}
			/>
			<p className="text-muted-foreground text-xs">
				Later nodes read{" "}
				<code className="font-mono">{`{{${node.id}.ended}}`}</code> (the outcome
				the called flow ended on)
				{outputs.length > 0 ? (
					<>
						{" "}
						and its outputs:{" "}
						{outputs.map((output, index) => (
							<span key={output.name}>
								{index > 0 ? ", " : null}
								<code className="font-mono">{`{{${node.id}.${output.name}}}`}</code>
							</span>
						))}
					</>
				) : null}
				.
			</p>
		</>
	);
}
