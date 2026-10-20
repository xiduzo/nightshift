/**
 * The inspector of the selected node. It shows what every node has (id,
 * label, device, limits) and hands the rest to the fields of the node's type,
 * one file per type in this folder.
 */
import {
	type CallEach,
	type Flow,
	type FlowNode,
	type NodeOption,
	nodeIdSchema,
} from "@nightshift/flows";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import { Input } from "@nightshift/ui/components/input";
import { PlayIcon, Trash2Icon } from "lucide-react";
import { useId, useState } from "react";
import { NODE_TYPE } from "../../canvas/node-type";
import type { DaemonConnection } from "../connections-field";
import {
	type DeviceChoice,
	DeviceField,
	runsOnDevice,
	withDevice,
} from "../device-field";
import {
	Field,
	InspectorHeader,
	InspectorSection,
	PositiveIntInput,
} from "../fields";
import { VariableWritesSection } from "../variable-writes-field";
import { AgentAdvanced } from "./agent-advanced";
import { AgentFields } from "./agent-fields";
import { CallFields } from "./call-fields";
import type { CalledFlowSupport } from "./called-flow-fields";
import { CommandFields } from "./command-fields";
import { DecisionFields } from "./decision-fields";
import { ToolFields } from "./tool-fields";
import { ValueFields } from "./value-fields";
import { WaitFields } from "./wait-fields";

export function NodeInspector({
	projectId,
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
	connections,
	devices,
}: {
	projectId: string;
	flow: Flow;
	node: FlowNode;
	/** Your devices, for where a step runs; undefined while they load. */
	devices?: readonly DeviceChoice[];
	/** The daemon's connections, for an Agent or Tool node; undefined while they load. */
	connections?: readonly DaemonConnection[];
	/** Subflow nodes: the project's flows and the actions on them. */
	calledFlows: CalledFlowSupport;
	onChange: (change: (node: FlowNode) => FlowNode) => void;
	/** Returns an error message when the new id is taken. */
	onRename: (id: string) => string | null;
	/** Renames a Decision option, Agent outcome or Command exit and moves its edges along. */
	onRenameOutcome: (index: number, name: string) => string | null;
	/** Removes a Decision option, Agent outcome or Command exit and drops its edges. */
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
					projectId={projectId}
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
					onRenameOutcome={onRenameOutcome}
					onRemoveOutcome={onRemoveOutcome}
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

			{node.type === "wait" ? (
				<WaitFields
					flow={flow}
					node={node}
					onChange={(change) =>
						onChange((current) =>
							current.type === "wait" ? change(current) : current,
						)
					}
				/>
			) : null}

			{node.type === "tool" ? (
				<ToolFields
					flow={flow}
					node={node}
					connections={connections}
					onChange={(change) =>
						onChange((current) =>
							current.type === "tool" ? change(current) : current,
						)
					}
				/>
			) : null}

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

			<VariableWritesSection flow={flow} node={node} onChange={onChange} />

			{runsOnDevice(node) ? (
				<InspectorSection
					title="Device"
					defaultOpen={"device" in node && node.device !== undefined}
				>
					<DeviceField
						id={`${id}-device`}
						value={"device" in node ? node.device : undefined}
						devices={devices}
						profile={node.type === "agent" ? node.profile : undefined}
						onChange={(device) =>
							onChange((current) => withDevice(current, device))
						}
					/>
				</InspectorSection>
			) : null}

			{/* A Gate (a Decision decided by you) waits as long as it must: no limits. */}
			{node.type === "decision" && node.by === "person" ? null : (
				<InspectorSection
					title="Limits"
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
