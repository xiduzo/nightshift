import {
	type AgentNode,
	type CallEach,
	type CommandNode,
	type DecisionNode,
	type Flow,
	type FlowNode,
	nodeIdSchema,
	nodeOutcomes,
	type Outcome,
	type ValueNode,
} from "@nightshift/flows";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import { Input } from "@nightshift/ui/components/input";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemGroup,
	ItemMedia,
} from "@nightshift/ui/components/item";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { Textarea } from "@nightshift/ui/components/textarea";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@nightshift/ui/components/toggle-group";
import { useQuery } from "@tanstack/react-query";
import {
	ArrowRightIcon,
	PlayIcon,
	PlusIcon,
	Trash2Icon,
	TriangleAlertIcon,
	XIcon,
} from "lucide-react";
import { type ReactNode, useId, useState } from "react";

import { ModelCombobox } from "@/components/agents/model-combobox";
import type { ProfileRow } from "@/components/agents/types";
import {
	DECIDED_BY_ICON,
	NODE_TYPE,
	VALUE_BY_ICON,
} from "@/components/flow/node-type";
import { outcomeLabel } from "@/components/outcome-badge";
import {
	EFFORTS,
	PERMISSION_MODES,
	permissionLabel,
} from "@/lib/agent-options";
import type { Effort, PermissionMode } from "@/lib/api-types";
import {
	type NodeOption,
	nodeOptions,
	type OptionNode,
	withConnections,
	withDecidedBy,
	withOptions,
	withValueBy,
} from "@/lib/flow-draft";
import {
	HARNESSES,
	type HarnessName,
	harnessInfo,
	switchHarness,
} from "@/lib/harnesses";
import { orpc } from "@/utils/orpc";
import { CallFields } from "./call-fields";
import type { CalledFlowSupport } from "./called-flow-fields";
import { CliToolsField } from "./cli-tools-field";
import { ConnectionsField, type DaemonConnection } from "./connections-field";
import { OutcomePill } from "./edge-inspector";
import {
	Field,
	InspectorHeader,
	InspectorSection,
	Note,
	PositiveIntInput,
} from "./fields";
import { McpServersField } from "./mcp-servers-field";
import { OptionsEditor } from "./options-editor";
import { OutputSchemaField } from "./output-schema-field";

import { TemplateField } from "./template-field";

/**
 * The node without one of its optional fields: it comes from the default
 * again (an Agent node's profile, a Decision or Value node's decider).
 */
function withoutField<N extends AgentNode | DecisionNode | ValueNode>(
	node: N,
	key: "harness" | "model" | "effort" | "permissionMode",
): N {
	const { [key as keyof N]: _dropped, ...rest } = node;
	return rest as N;
}

/**
 * The node on another profile, or on none. Picking a profile hands it the
 * harness, model, effort and permission mode (the node's own go); picking
 * none keeps what the old profile gave, so the node runs as before.
 */
function pickProfile(
	node: AgentNode,
	next: ProfileRow | undefined,
	before: ProfileRow | undefined,
): AgentNode {
	const {
		profile: _profile,
		harness,
		model,
		effort,
		permissionMode,
		...rest
	} = node;
	if (next) return { ...rest, profile: next.name };
	const kept: AgentNode = {
		...rest,
		harness: harness ?? before?.harness ?? "claude-code",
		model: model ?? before?.model ?? harnessInfo("claude-code").defaultModel,
		permissionMode: permissionMode ?? before?.permissionMode ?? "auto",
	};
	const keptEffort = effort ?? before?.effort;
	if (keptEffort !== undefined) kept.effort = keptEffort;
	return kept;
}

/** The edges of the selected node, and the actions on them. */
export type NodeEdgeSupport = {
	/** Adds an edge from the node on `outcome` to `to`. */
	onAdd: (outcome: Outcome, to: string) => void;
	onSelect: (edgeId: string) => void;
	onDelete: (edgeId: string) => void;
};

export function NodeInspector({
	flow,
	node,
	onChange,
	onRename,
	onRenameOutcome,
	onRemoveOutcome,
	onSetAgentOutcomes,
	onSetCallEach,
	onSetStart,
	onDelete,
	calledFlows,
	edges,
	connections,
}: {
	flow: Flow;
	node: FlowNode;
	/** The daemon's connections, for an Agent node; undefined while they load. */
	connections?: readonly DaemonConnection[];
	/** Call nodes: the project's flows and the actions on them. */
	calledFlows: CalledFlowSupport;
	/** The node's outgoing edges. Without it the inspector does not list them. */
	edges?: NodeEdgeSupport;
	onChange: (change: (node: FlowNode) => FlowNode) => void;
	/** Returns an error message when the new id is taken. */
	onRename: (id: string) => string | null;
	/** Renames a Decision label, Gate choice or Agent outcome and moves its edges along. */
	onRenameOutcome: (index: number, name: string) => string | null;
	/** Removes a Decision label, Gate choice or Agent outcome and drops its edges. */
	onRemoveOutcome: (index: number) => void;
	/** Gives an Agent node its own outcomes, or back the standard ones; drops edges that no longer fit. */
	onSetAgentOutcomes: (outcomes: NodeOption[] | undefined) => void;
	/** Makes a Call node run once per item (`each`) or once; drops edges that no longer fit. */
	onSetCallEach: (each: CallEach | undefined) => void;
	onSetStart: () => void;
	onDelete: () => void;
}) {
	const id = useId();
	const isStart = flow.start === node.id;
	const { label: typeLabel, icon: Icon } = NODE_TYPE[node.type];

	return (
		<div className="flex flex-col">
			<InspectorHeader
				icon={Icon}
				kicker={typeLabel}
				title={node.id}
				badges={
					isStart ? (
						<Badge variant="secondary" className="normal-case tracking-normal">
							<PlayIcon aria-hidden="true" />
							Start
						</Badge>
					) : null
				}
				actions={
					<>
						{isStart ? null : (
							<Button
								variant="outline"
								size="sm"
								onClick={onSetStart}
								title="Start the run here"
							>
								<PlayIcon data-icon="inline-start" />
								Set as start
							</Button>
						)}
						<Button
							variant="ghost"
							size="icon-sm"
							className="text-destructive hover:bg-destructive/10 hover:text-destructive"
							onClick={onDelete}
							aria-label={`Delete ${node.id}`}
							title="Delete node (Backspace)"
						>
							<Trash2Icon />
						</Button>
					</>
				}
			/>

			<InspectorSection title="Node">
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
							onChange((current) => ({
								...current,
								label: label || undefined,
							}));
						}}
					/>
				</Field>
			</InspectorSection>

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

			{node.type === "call" ? (
				<CallFields
					flow={flow}
					node={node}
					support={calledFlows}
					onChange={(change) =>
						onChange((current) =>
							current.type === "call" ? change(current) : current,
						)
					}
					onSetEach={onSetCallEach}
				/>
			) : null}

			{node.type === "value" ? (
				<ValueFields
					flow={flow}
					node={node}
					onChange={(change) =>
						onChange((current) =>
							current.type === "value" ? change(current) : current,
						)
					}
				/>
			) : null}

			{edges ? <EdgesSection flow={flow} node={node} edges={edges} /> : null}

			{node.type === "agent" ? (
				<AgentAdvanced
					node={node}
					connections={connections}
					onChange={(change) =>
						onChange((current) =>
							current.type === "agent" ? change(current) : current,
						)
					}
				/>
			) : null}

			{/* A Gate (a Decision decided by you) waits as long as it must: no limits. */}
			{node.type === "decision" && node.by === "person" ? null : (
				<InspectorSection
					title="Limits"
					collapsible
					defaultOpen={
						node.timeoutMinutes !== undefined ||
						(node.type === "agent" && node.idleMinutes !== undefined)
					}
				>
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
					{node.type === "agent" ? (
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
									onChange((current) =>
										current.type === "agent"
											? { ...current, idleMinutes }
											: current,
									)
								}
							/>
						</Field>
					) : null}
				</InspectorSection>
			)}
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
					Later nodes use its outputs as{" "}
					<code className="font-mono">{`{{${nodeId}.field}}`}</code>. Renaming
					it updates every edge and reference.
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

/**
 * The node's outgoing edges, one row each: a click selects the edge. Below,
 * a row to add one without dragging a handle, which also works on a phone.
 */
function EdgesSection({
	flow,
	node,
	edges,
}: {
	flow: Flow;
	node: FlowNode;
	edges: NodeEdgeSupport;
}) {
	const id = useId();
	const outgoing = flow.edges.filter((edge) => edge.from === node.id);
	const outcomes = [...new Set(nodeOutcomes(node))];
	const targets = flow.nodes.map((candidate) => candidate.id);
	const unused = outcomes.find(
		(outcome) => !outgoing.some((edge) => edge.outcome === outcome),
	);
	const [outcomeChoice, setOutcome] = useState<string>(
		unused ?? outcomes[0] ?? "",
	);
	const [toChoice, setTo] = useState<string>(
		targets.find((target) => target !== node.id) ?? targets[0] ?? "",
	);
	// Labels and nodes come and go: fall back when a pick is gone.
	const outcome = outcomes.includes(outcomeChoice)
		? outcomeChoice
		: (outcomes[0] ?? "");
	const to = targets.includes(toChoice) ? toChoice : (targets[0] ?? "");
	const exists = outgoing.some(
		(edge) => edge.outcome === outcome && edge.to === to,
	);
	const canAdd = outcome !== "" && to !== "" && !exists;

	return (
		<InspectorSection
			title="Edges"
			aside={
				<Badge variant="secondary" className="tabular-nums">
					{outgoing.length}
				</Badge>
			}
		>
			{outgoing.length === 0 ? (
				<Note>
					No edge leaves this node yet. Drag from an outcome dot on the canvas,
					or add one below.
				</Note>
			) : (
				<ItemGroup className="gap-1.5">
					{outgoing.map((edge) => (
						<Item
							key={edge.id}
							role="listitem"
							variant="outline"
							size="xs"
							className="flex-nowrap gap-1.5 py-1 pr-1"
						>
							<ItemMedia>
								<OutcomePill outcome={edge.outcome} />
							</ItemMedia>
							<ItemContent className="min-w-0">
								<Button
									variant="ghost"
									size="xs"
									className="w-full justify-start font-mono"
									title={`Select the edge ${edge.from} ${outcomeLabel(edge.outcome)} → ${edge.to}`}
									onClick={() => edges.onSelect(edge.id)}
								>
									<ArrowRightIcon
										className="text-muted-foreground"
										aria-label="to"
									/>
									<span className="truncate">{edge.to}</span>
								</Button>
							</ItemContent>
							<ItemActions className="gap-0.5">
								{edge.max ? (
									<Badge
										variant="outline"
										className="font-mono tabular-nums"
										title={`Taken at most ${edge.max} times`}
									>
										×{edge.max}
									</Badge>
								) : null}
								<Button
									variant="ghost"
									size="icon-xs"
									className="text-muted-foreground hover:text-destructive"
									aria-label={`Delete the edge ${outcomeLabel(edge.outcome)} to ${edge.to}`}
									title="Delete this edge"
									onClick={() => edges.onDelete(edge.id)}
								>
									<XIcon />
								</Button>
							</ItemActions>
						</Item>
					))}
				</ItemGroup>
			)}
			{outcomes.length > 0 && targets.length > 0 ? (
				<div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
					<Field id={`${id}-outcome`} label="On">
						<NativeSelect
							id={`${id}-outcome`}
							size="sm"
							className="font-mono text-xs"
							value={outcome}
							onChange={(event) => setOutcome(event.target.value)}
						>
							{outcomes.map((option) => (
								<NativeSelectOption key={option} value={option}>
									{outcomeLabel(option)}
								</NativeSelectOption>
							))}
						</NativeSelect>
					</Field>
					<Field id={`${id}-to`} label="To">
						<NativeSelect
							id={`${id}-to`}
							size="sm"
							className="font-mono text-xs"
							value={to}
							onChange={(event) => setTo(event.target.value)}
						>
							{targets.map((target) => (
								<NativeSelectOption key={target} value={target}>
									{target}
								</NativeSelectOption>
							))}
						</NativeSelect>
					</Field>
					<Button
						variant="outline"
						size="sm"
						disabled={!canAdd}
						title={exists ? "This edge exists" : "Add the edge"}
						onClick={() => edges.onAdd(outcome as Outcome, to)}
					>
						<PlusIcon data-icon="inline-start" />
						Add
					</Button>
				</div>
			) : null}
		</InspectorSection>
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
	const profiles = useQuery({
		...orpc.profiles.list.queryOptions(),
		staleTime: 30_000,
		meta: { quietErrors: true },
	});
	const profile =
		node.profile === undefined
			? undefined
			: profiles.data?.find((p) => p.name === node.profile);
	const unknownProfile =
		node.profile !== undefined && profiles.data !== undefined && !profile;
	// With a profile, a field the node leaves out comes from the profile.
	const harnessName: HarnessName =
		node.harness ?? profile?.harness ?? "claude-code";
	const harness = harnessInfo(harnessName);
	const fromProfile = (value: string) => `From the profile (${value})`;

	return (
		<>
			<InspectorSection title="Task">
				<Field
					id={`${id}-profile`}
					label="Profile"
					hint={
						unknownProfile
							? `There is no profile named ${node.profile}. The flow cannot run until you pick another or add it under Agents.`
							: profile
								? "This node uses the profile's settings. Change a field below to override it for this node only."
								: "A saved agent setup from the Agents page. Without one, set the harness and model below."
					}
				>
					<NativeSelect
						id={`${id}-profile`}
						value={node.profile ?? ""}
						aria-describedby={`${id}-profile-hint`}
						aria-invalid={unknownProfile || undefined}
						onChange={(event) => {
							const name = event.target.value;
							const next = profiles.data?.find((p) => p.name === name);
							onChange((current) => pickProfile(current, next, profile));
						}}
					>
						<NativeSelectOption value="">
							None: set it on this node
						</NativeSelectOption>
						{(profiles.data ?? []).map((p) => (
							<NativeSelectOption key={p.name} value={p.name}>
								{p.name} · {harnessInfo(p.harness).label} · {p.model}
							</NativeSelectOption>
						))}
						{unknownProfile ? (
							<NativeSelectOption value={node.profile}>
								{node.profile} (not found)
							</NativeSelectOption>
						) : null}
					</NativeSelect>
				</Field>

				<Field id={`${id}-harness`} label="Harness" hint={harness.note}>
					<NativeSelect
						id={`${id}-harness`}
						value={node.harness ?? ""}
						aria-describedby={`${id}-harness-hint`}
						onChange={(event) => {
							const next = event.target.value as HarnessName | "";
							onChange((current) =>
								next === ""
									? withoutField(current, "harness")
									: switchHarness(current, next),
							);
						}}
					>
						{node.profile !== undefined ? (
							<NativeSelectOption value="">
								{fromProfile(
									profile ? harnessInfo(profile.harness).label : "unknown",
								)}
							</NativeSelectOption>
						) : null}
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
							? `The agent gets /${node.skill}, then this prompt.`
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
					hint={`A skill that ${harness.label} already has. Leave out the slash.`}
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
							onChange((current) => ({
								...current,
								skill: skill || undefined,
							}));
						}}
					/>
				</Field>
			</InspectorSection>

			<InspectorSection title="Model">
				<div className="grid grid-cols-2 gap-3">
					<Field id={`${id}-model`} label="Model">
						<ModelCombobox
							id={`${id}-model`}
							harness={harnessName}
							value={node.model ?? ""}
							placeholder={
								node.profile !== undefined
									? profile?.model
									: harness.defaultModel
							}
							invalid={node.profile === undefined && !node.model?.trim()}
							onChange={(model) =>
								onChange((current) =>
									model === "" && current.profile !== undefined
										? withoutField(current, "model")
										: { ...current, model },
								)
							}
						/>
					</Field>
					<Field id={`${id}-effort`} label="Effort">
						<NativeSelect
							id={`${id}-effort`}
							value={node.effort ?? ""}
							onChange={(event) => {
								const effort = (event.target.value || undefined) as
									| Effort
									| undefined;
								onChange((current) =>
									effort === undefined
										? withoutField(current, "effort")
										: { ...current, effort },
								);
							}}
						>
							<NativeSelectOption value="">
								{profile
									? fromProfile(profile.effort ?? "model default")
									: "Model default"}
							</NativeSelectOption>
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
						value={node.permissionMode ?? ""}
						aria-invalid={
							node.profile === undefined && node.permissionMode === undefined
								? true
								: undefined
						}
						onChange={(event) => {
							const permissionMode = event.target.value as PermissionMode | "";
							onChange((current) =>
								permissionMode === ""
									? withoutField(current, "permissionMode")
									: { ...current, permissionMode },
							);
						}}
					>
						{node.profile !== undefined ? (
							<NativeSelectOption value="">
								{fromProfile(
									profile ? permissionLabel(profile.permissionMode) : "unknown",
								)}
							</NativeSelectOption>
						) : node.permissionMode === undefined ? (
							<NativeSelectOption value="" disabled>
								Pick a permission mode
							</NativeSelectOption>
						) : null}
						{PERMISSION_MODES.map(({ value, label }) => (
							<NativeSelectOption key={value} value={value}>
								{label}
							</NativeSelectOption>
						))}
					</NativeSelect>
					{(node.permissionMode ?? profile?.permissionMode) ===
					"bypassPermissions" ? (
						<p className="flex items-start gap-1.5 text-status-waiting text-xs">
							<TriangleAlertIcon
								className="mt-px size-3.5 shrink-0"
								aria-hidden="true"
							/>
							The agent runs every tool, shell commands included, without
							asking.
						</p>
					) : null}
				</Field>

				<Field
					id={`${id}-session`}
					label="Session on a later visit"
					hint={
						node.session === "fresh"
							? "A retry starts over with only the prompt."
							: "A retry continues where the agent left off, with everything it knew."
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
			</InspectorSection>

			<AgentOutcomesField
				id={`${id}-outcomes`}
				node={node}
				flow={flow}
				onChange={onChange}
				onRenameOutcome={onRenameOutcome}
				onRemoveOutcome={onRemoveOutcome}
				onSetOutcomes={onSetOutcomes}
				note={
					<Note>
						Harness: <span className="text-foreground">{harness.label}</span>
						{profile && node.harness === undefined ? " (from the profile)" : ""}
						. When it is done, the agent reports{" "}
						{node.outcomes
							? `one of its own outcomes (${node.outcomes.map((o) => o.name).join(", ")})`
							: "pass, fail, or needs input"}
						, a summary
						{node.output ? ", and data in the shape of the output schema" : ""}.
					</Note>
				}
			/>
		</>
	);
}

/** An Agent node's advanced settings, below its edges. */
function AgentAdvanced({
	node,
	connections,
	onChange,
}: {
	node: AgentNode;
	connections: readonly DaemonConnection[] | undefined;
	onChange: (change: (node: AgentNode) => AgentNode) => void;
}) {
	const profiles = useQuery({
		...orpc.profiles.list.queryOptions(),
		staleTime: 30_000,
		meta: { quietErrors: true },
	});
	const profile =
		node.profile === undefined
			? undefined
			: profiles.data?.find((p) => p.name === node.profile);
	const id = useId();
	const serverCount = Object.keys(node.mcpServers ?? {}).length;
	const cliTools = useQuery({
		...orpc.cliTools.list.queryOptions(),
		staleTime: 30_000,
		meta: { quietErrors: true },
	});
	const clis = node.clis ?? [];
	const missingClis = cliTools.data
		? clis.filter((name) => !cliTools.data.some((t) => t.name === name))
		: [];
	const named = node.connections ?? [];
	const missing = connections
		? named.filter((name) => !connections.some((c) => c.name === name))
		: [];
	return (
		<>
			<InspectorSection
				title="Report data"
				collapsible
				defaultOpen={node.output !== undefined}
				aside={
					node.output !== undefined ? (
						<Badge variant="secondary">schema</Badge>
					) : null
				}
			>
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
			</InspectorSection>

			<InspectorSection
				title="CLI tools"
				collapsible
				defaultOpen={clis.length > 0 || (cliTools.data?.length ?? 0) > 0}
				aside={
					missingClis.length > 0 ? (
						<Badge variant="destructive" className="tabular-nums">
							{missingClis.length} missing
						</Badge>
					) : clis.length > 0 ? (
						<Badge variant="secondary" className="tabular-nums">
							{clis.length}
						</Badge>
					) : null
				}
			>
				{profile && profile.clis.length > 0 ? (
					<Note>
						The profile adds{" "}
						<span className="font-mono text-foreground">
							{profile.clis.join(", ")}
						</span>
						. Pick more here for this node only.
					</Note>
				) : null}
				<CliToolsField
					id={`${id}-clis`}
					names={clis}
					tools={cliTools.data}
					onChange={(names) =>
						onChange(({ clis: _, ...rest }) =>
							names.length > 0 ? { ...rest, clis: names } : rest,
						)
					}
				/>
			</InspectorSection>

			<InspectorSection
				title="Connections"
				collapsible
				defaultOpen={named.length > 0 || (connections?.length ?? 0) > 0}
				aside={
					missing.length > 0 ? (
						<Badge variant="destructive" className="tabular-nums">
							{missing.length} missing
						</Badge>
					) : named.length > 0 ? (
						<Badge variant="secondary" className="tabular-nums">
							{named.length}
						</Badge>
					) : null
				}
			>
				{profile && profile.connections.length > 0 ? (
					<Note>
						The profile adds{" "}
						<span className="font-mono text-foreground">
							{profile.connections.join(", ")}
						</span>
						. Pick more here for this node only.
					</Note>
				) : null}
				<ConnectionsField
					id={`${id}-connections`}
					names={named}
					connections={connections}
					onChange={(names) =>
						onChange((current) => withConnections(current, names))
					}
				/>
			</InspectorSection>

			<InspectorSection
				title={
					<>
						Inline MCP servers{" "}
						<span className="normal-case tracking-normal">
							(this flow only)
						</span>
					</>
				}
				collapsible
				defaultOpen={serverCount > 0}
				aside={
					serverCount > 0 ? (
						<Badge variant="secondary" className="tabular-nums">
							{serverCount}
						</Badge>
					) : null
				}
			>
				<McpServersField
					id={`${id}-mcp`}
					servers={node.mcpServers}
					onChange={(mcpServers) =>
						onChange(({ mcpServers: _, ...rest }) =>
							mcpServers === undefined ? rest : { ...rest, mcpServers },
						)
					}
				/>
			</InspectorSection>
		</>
	);
}

/** What a Command node keeps of its output, in the order the toggle shows them. */
const COMMAND_OUTPUTS: { value: CommandNode["output"]; label: string }[] = [
	{ value: "text", label: "Text" },
	{ value: "json", label: "JSON" },
];

function CommandFields({
	node,
	onChange,
}: {
	node: CommandNode;
	onChange: (change: (node: CommandNode) => CommandNode) => void;
}) {
	const id = useId();
	return (
		<InspectorSection title="Command">
			<Field
				id={`${id}-command`}
				label="Command"
				hint='The step passes when the command succeeds, and fails when it does not. Put templates in quotes, for example: echo "{{worker.summary}}".'
			>
				<Textarea
					id={`${id}-command`}
					value={node.command}
					placeholder="bun run check"
					className="min-h-20 font-mono text-xs leading-relaxed"
					spellCheck={false}
					aria-invalid={node.command.trim() === ""}
					aria-describedby={`${id}-command-hint`}
					onChange={(event) => {
						const command = event.target.value;
						onChange((current) => ({ ...current, command }));
					}}
				/>
			</Field>
			<Field
				id={`${id}-output`}
				label="Output"
				hint={
					node.output === "json" ? (
						<>
							The command prints JSON. Later nodes read it as{" "}
							<code className="font-mono">{`{{${node.id}.data.tests}}`}</code>.
							Output that is not JSON fails the step.
						</>
					) : (
						<>
							Later nodes read the last lines as{" "}
							<code className="font-mono">{`{{${node.id}.log_tail}}`}</code>.
						</>
					)
				}
			>
				<ToggleGroup
					variant="outline"
					size="sm"
					spacing={0}
					aria-label="Output"
					aria-describedby={`${id}-output-hint`}
					className="w-full"
					value={[node.output]}
					onValueChange={(value) => {
						const output = value[0] as CommandNode["output"] | undefined;
						if (output) onChange((current) => ({ ...current, output }));
					}}
				>
					{COMMAND_OUTPUTS.map((entry) => (
						<ToggleGroupItem
							key={entry.value}
							value={entry.value}
							className="flex-1 aria-pressed:bg-primary aria-pressed:text-primary-foreground"
						>
							{entry.label}
						</ToggleGroupItem>
					))}
				</ToggleGroup>
			</Field>
		</InspectorSection>
	);
}

/** The options or outcomes of a node, with the edits that keep its edges in step. */
function NodeOptionsField<T extends OptionNode>({
	id,
	kind,
	node,
	min,
	hint,
	rules = false,
	onChange,
	onRenameOutcome,
	onRemoveOutcome,
	children,
}: {
	id: string;
	kind: "option" | "outcome";
	node: T;
	min: number;
	hint: string;
	/** Each option takes a rule (a Decision decided by a rule). */
	rules?: boolean;
	onChange: (change: (node: T) => T) => void;
	onRenameOutcome: (index: number, name: string) => string | null;
	onRemoveOutcome: (index: number) => void;
	/** Below the list, such as a way back to the standard outcomes. */
	children?: ReactNode;
}) {
	const options = nodeOptions(node);
	const change = (edit: (options: NodeOption[]) => NodeOption[]) =>
		onChange((current) => withOptions(current, edit(nodeOptions(current))));

	return (
		<InspectorSection
			title={kind === "option" ? "Options" : "Outcomes"}
			aside={
				<Badge variant="secondary" className="tabular-nums">
					{options.length}
				</Badge>
			}
			className="gap-3"
		>
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
				onRule={
					rules
						? (index, when) =>
								change((list) =>
									list.map((option, at) => {
										if (at !== index) return option;
										const { when: _, ...rest } = option;
										return when === undefined ? rest : { ...rest, when };
									}),
								)
						: undefined
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
			{children}
		</InspectorSection>
	);
}

/** Who decides, in the order the toggle shows them. */
const DECIDED_BY: {
	by: DecisionNode["by"];
	label: string;
}[] = [
	{ by: "person", label: "You" },
	{ by: "rule", label: "A rule" },
	{ by: "model", label: "A model" },
];

/**
 * One Decision node, three ways to decide. The prompt is the question for
 * you, a note for a rule, or the brief for a model. The options are the
 * outcomes; with a rule, each option carries the rule that picks it.
 */
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
	const { by } = node;
	const prompt =
		by === "person"
			? {
					label: "Question",
					hint: "What you are asked in the Needs-you inbox, with the context you need to answer. The run waits until you do.",
					placeholder:
						"The worker opened {{worker.summary}}. Merge it and go on?",
					invalid: node.prompt.trim() === "",
				}
			: by === "model"
				? {
						label: "Prompt",
						hint: "What to decide, with the context it needs. The model picks one option and notes why.",
						placeholder:
							"Read {{check.log_tail}}. Is the build green enough to open a pull request?",
						invalid: node.prompt.trim() === "",
					}
				: {
						label: "Note",
						hint: "Optional. A note for you on what the rules check. Nothing reads it.",
						placeholder: "Ship when the tests pass and the check exits 0.",
						invalid: false,
					};
	const optionsHint =
		by === "person"
			? "Each option is a button in the inbox, with its own edge."
			: by === "model"
				? "The model picks exactly one. Each option gets its own edge. A description tells the model when to pick it."
				: "Night Shift tries the rules from top to bottom and picks the first option whose rule holds. Leave the last option without a rule: it is picked when none holds.";

	const deciders = useQuery(orpc.deciders.list.queryOptions());
	const decider = deciders.data?.find((d) => d.name === node.decider);
	const keyMissing = decider?.apiKeySource === "missing";
	return (
		<>
			<InspectorSection title="Decision">
				<Field
					id={`${id}-by`}
					label="Decided by"
					hint={
						by === "person"
							? "The run waits in the Needs-you inbox until you pick an option."
							: by === "rule"
								? "A rule reads the values of earlier nodes and inputs. No model, no cost."
								: "A small model reads the prompt and picks an option."
					}
				>
					<ToggleGroup
						variant="outline"
						size="sm"
						spacing={0}
						aria-label="Decided by"
						className="w-full"
						value={[by]}
						onValueChange={(value) => {
							const next = value[0] as DecisionNode["by"] | undefined;
							if (next) onChange((current) => withDecidedBy(current, next));
						}}
					>
						{DECIDED_BY.map((entry) => {
							const Icon = DECIDED_BY_ICON[entry.by];
							return (
								<ToggleGroupItem
									key={entry.by}
									value={entry.by}
									className="flex-1 aria-pressed:bg-primary aria-pressed:text-primary-foreground"
								>
									<Icon />
									{entry.label}
								</ToggleGroupItem>
							);
						})}
					</ToggleGroup>
				</Field>
				<TemplateField
					id={`${id}-prompt`}
					label={prompt.label}
					hint={prompt.hint}
					flow={flow}
					nodeId={node.id}
					value={node.prompt}
					invalid={prompt.invalid}
					className={by === "person" ? "font-sans text-sm" : undefined}
					placeholder={prompt.placeholder}
					onChange={(text) =>
						onChange((current) => ({ ...current, prompt: text }))
					}
				/>
			</InspectorSection>

			<NodeOptionsField
				id={`${id}-options`}
				kind="option"
				node={node}
				min={1}
				hint={optionsHint}
				rules={by === "rule"}
				onChange={onChange}
				onRenameOutcome={onRenameOutcome}
				onRemoveOutcome={onRemoveOutcome}
			>
				{by === "rule" ? (
					<Note>
						A rule is a JSONata expression over the run's values. Write a node
						id or an input name, then a path:{" "}
						<code>build.data.tests_passed = true and check.exit_code = 0</code>.
						Put a name with a dash in backticks: <code>`my-input` = "x"</code>.
						Later nodes read the pick as <code>{`{{${node.id}.outcome}}`}</code>
						.
					</Note>
				) : (
					<Note>
						Later nodes read the pick as <code>{`{{${node.id}.outcome}}`}</code>{" "}
						and {by === "person" ? "your note" : "why the model picked it"} as{" "}
						<code>{`{{${node.id}.note}}`}</code>.
					</Note>
				)}
			</NodeOptionsField>

			{by === "model" ? (
				<InspectorSection title="Model">
					<Field
						id={`${id}-decider`}
						label="Decider"
						hint={
							keyMissing && decider?.apiKey
								? `Add the secret ${decider.apiKey} on the Agents page, or this node cannot decide.`
								: "The decision model that picks the option."
						}
					>
						<NativeSelect
							id={`${id}-decider`}
							value={node.decider}
							aria-invalid={keyMissing}
							aria-describedby={`${id}-decider-hint`}
							onChange={(event) => {
								const next = event.target.value as DecisionNode["decider"];
								// A model belongs to its decider: the new one starts on its default.
								onChange((current) => ({
									...withoutField(current, "model"),
									decider: next,
								}));
							}}
						>
							{(deciders.data ?? []).map((d) => (
								<NativeSelectOption key={d.name} value={d.name}>
									{d.label}
								</NativeSelectOption>
							))}
						</NativeSelect>
					</Field>
					<Field
						id={`${id}-model`}
						label="Model"
						optional
						hint="Leave it empty to use the decider's default model."
					>
						<Input
							id={`${id}-model`}
							list={`${id}-models`}
							value={node.model ?? ""}
							placeholder={decider?.defaultModel}
							className="font-mono"
							autoComplete="off"
							spellCheck={false}
							aria-describedby={`${id}-model-hint`}
							onChange={(event) => {
								const model = event.target.value.trim();
								onChange((current) =>
									model === ""
										? withoutField(current, "model")
										: { ...current, model },
								);
							}}
						/>
						<datalist id={`${id}-models`}>
							{(decider?.models ?? []).map((value) => (
								<option key={value} value={value} />
							))}
						</datalist>
					</Field>
				</InspectorSection>
			) : null}
		</>
	);
}

const VALUE_BY: { by: ValueNode["by"]; label: string }[] = [
	{ by: "rule", label: "A rule" },
	{ by: "model", label: "A model" },
];

const EXPRESSION_EXAMPLE =
	'$filter(planner.data.tasks, function($t) { $t.size = "small" })';

/**
 * A Value node makes data that fits its output schema. Who makes it is a
 * toggle, as on a Decision: a rule (a JSONata expression) or a model (a
 * decider that can make a value, with a prompt).
 */
function ValueFields({
	flow,
	node,
	onChange,
}: {
	flow: Flow;
	node: ValueNode;
	onChange: (change: (node: ValueNode) => ValueNode) => void;
}) {
	const id = useId();
	const { by } = node;
	const deciders = useQuery(orpc.deciders.list.queryOptions());
	const makers = (deciders.data ?? []).filter((d) => d.value !== null);
	const decider = deciders.data?.find((d) => d.name === node.decider);
	const keyMissing = decider?.apiKeySource === "missing";
	const cannot = decider !== undefined && decider.value === null;
	const expression = node.expression ?? "";
	const prompt = node.prompt ?? "";
	return (
		<>
			<InspectorSection title="Value">
				<Field
					id={`${id}-by`}
					label="Made by"
					hint={
						by === "rule"
							? "An expression reads the values of earlier nodes and inputs. No model, no cost."
							: "A small model reads the prompt and answers with data in the shape below."
					}
				>
					<ToggleGroup
						variant="outline"
						size="sm"
						spacing={0}
						aria-label="Made by"
						className="w-full"
						value={[by]}
						onValueChange={(value) => {
							const next = value[0] as ValueNode["by"] | undefined;
							if (next) onChange((current) => withValueBy(current, next));
						}}
					>
						{VALUE_BY.map((entry) => {
							const Icon = VALUE_BY_ICON[entry.by];
							return (
								<ToggleGroupItem
									key={entry.by}
									value={entry.by}
									className="flex-1 aria-pressed:bg-primary aria-pressed:text-primary-foreground"
								>
									<Icon />
									{entry.label}
								</ToggleGroupItem>
							);
						})}
					</ToggleGroup>
				</Field>
				{by === "rule" ? (
					<Field
						id={`${id}-expression`}
						label="Expression"
						hint="A JSONata expression over the run's values. Its result is the data."
						error={expression.trim() === "" ? "Write the expression." : null}
					>
						<Textarea
							id={`${id}-expression`}
							value={expression}
							placeholder={EXPRESSION_EXAMPLE}
							className="min-h-24 font-mono text-xs leading-relaxed"
							spellCheck={false}
							aria-invalid={expression.trim() === ""}
							aria-describedby={`${id}-expression-hint`}
							onChange={(event) => {
								const text = event.target.value;
								onChange((current) => ({ ...current, expression: text }));
							}}
						/>
					</Field>
				) : (
					<TemplateField
						id={`${id}-prompt`}
						label="Prompt"
						hint="What to make, with the context it needs. The model answers with data in the shape below."
						flow={flow}
						nodeId={node.id}
						value={prompt}
						invalid={prompt.trim() === ""}
						placeholder="List the failing tests in {{check.log_tail}}."
						onChange={(text) =>
							onChange((current) => ({ ...current, prompt: text }))
						}
					/>
				)}
				{by === "rule" ? (
					<Note>
						Write a node id or an input name, then a path:{" "}
						<code>{EXPRESSION_EXAMPLE}</code>. Put a name with a dash in
						backticks: <code>`my-input`.title</code>. Later nodes read the data
						as <code>{`{{${node.id}.data}}`}</code> or a path into it.
					</Note>
				) : (
					<Note>
						Later nodes read the data as <code>{`{{${node.id}.data}}`}</code> or
						a path into it, and why it failed as{" "}
						<code>{`{{${node.id}.note}}`}</code>.
					</Note>
				)}
			</InspectorSection>

			<InspectorSection title="Data">
				<OutputSchemaField
					id={`${id}-output`}
					nodeId={node.id}
					output={node.output}
					required
					description="The shape of the data this node makes. The step fails when the result does not fit."
					onChange={(output) =>
						onChange((current) =>
							output === undefined ? current : { ...current, output },
						)
					}
				/>
			</InspectorSection>

			{by === "model" ? (
				<InspectorSection title="Model">
					<Field
						id={`${id}-decider`}
						label="Decider"
						hint={
							cannot
								? "This decider cannot make a value. Choose one that can."
								: keyMissing && decider?.apiKey
									? `Add the secret ${decider.apiKey} on the Agents page, or this node cannot make a value.`
									: "The decider whose model makes the value."
						}
					>
						<NativeSelect
							id={`${id}-decider`}
							value={node.decider}
							aria-invalid={keyMissing || cannot}
							aria-describedby={`${id}-decider-hint`}
							onChange={(event) => {
								const next = event.target.value as ValueNode["decider"];
								// A model belongs to its decider: the new one starts on its default.
								onChange((current) => ({
									...withoutField(current, "model"),
									decider: next,
								}));
							}}
						>
							{cannot && decider ? (
								<NativeSelectOption value={decider.name} disabled>
									{decider.label}
								</NativeSelectOption>
							) : null}
							{makers.map((d) => (
								<NativeSelectOption key={d.name} value={d.name}>
									{d.label}
								</NativeSelectOption>
							))}
						</NativeSelect>
					</Field>
					<Field
						id={`${id}-model`}
						label="Model"
						optional
						hint="Leave it empty to use the decider's default model."
					>
						<Input
							id={`${id}-model`}
							value={node.model ?? ""}
							placeholder={decider?.value?.defaultModel}
							className="font-mono"
							autoComplete="off"
							spellCheck={false}
							aria-describedby={`${id}-model-hint`}
							onChange={(event) => {
								const model = event.target.value.trim();
								onChange((current) =>
									model === ""
										? withoutField(current, "model")
										: { ...current, model },
								);
							}}
						/>
					</Field>
				</InspectorSection>
			) : null}
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
	note,
	onChange,
	onRenameOutcome,
	onRemoveOutcome,
	onSetOutcomes,
}: {
	id: string;
	node: AgentNode;
	flow: Flow;
	note: ReactNode;
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
			<InspectorSection title="Outcomes" className="gap-3">
				<div className="flex flex-wrap gap-1.5">
					{(["pass", "fail", "needs-input"] as const).map((outcome) => (
						<OutcomePill key={outcome} outcome={outcome} />
					))}
				</div>
				<p className="text-muted-foreground text-xs">
					The agent reports pass, fail, or needs input. Give it its own
					outcomes, such as approved and changes-requested, each with its own
					edge.
				</p>
				<Button
					variant="outline"
					size="sm"
					className="self-start"
					onClick={() => onSetOutcomes(seed)}
				>
					Use own outcomes
				</Button>
				{note}
			</InspectorSection>
		);
	}
	return (
		<NodeOptionsField
			id={id}
			kind="outcome"
			node={node}
			min={1}
			hint="The agent picks exactly one. Each outcome gets its own edge. A description tells the agent when to pick it."
			onChange={onChange}
			onRenameOutcome={onRenameOutcome}
			onRemoveOutcome={onRemoveOutcome}
		>
			<Button
				variant="ghost"
				size="sm"
				className="self-start"
				onClick={() => onSetOutcomes(undefined)}
			>
				Back to pass, fail and needs input
			</Button>
			{note}
		</NodeOptionsField>
	);
}
