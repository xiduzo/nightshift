/**
 * The inspector of the selected node. It shows what every node has (id,
 * label, device, limits) and hands the rest to the fields of the node's type,
 * one file per type in this folder.
 */
import {
	type CallEach,
	type Flow,
	type FlowNode,
	isProfileRef,
	type NodeOption,
	nodeIdSchema,
} from "@nightshift/flows";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import { Input } from "@nightshift/ui/components/input";
import { useQuery } from "@tanstack/react-query";
import { PlayIcon, Trash2Icon } from "lucide-react";
import { useId, useState } from "react";
import { runQueries } from "@/features/runs/queries";
import { nodeMeta } from "../../canvas/node-type";
import type { DaemonConnection } from "../connections-field";
import { DeviceField, runsOnDevice, withDevice } from "../device-field";
import { Field, InspectorSection, PositiveIntInput } from "../fields";
import { InspectorTabs } from "../inspector-tabs";
import { VariableWritesSection } from "../variable-writes-field";
import { AgentAdvanced } from "./agent-advanced";
import { AgentFields } from "./agent-fields";
import { CallFields } from "./call-fields";
import type { CalledFlowSupport } from "./called-flow-fields";
import { CommandFields } from "./command-fields";
import { DecisionFields } from "./decision-fields";
import { EndFields } from "./end-fields";
import { JoinFields } from "./join-fields";
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
}: {
	projectId: string;
	flow: Flow;
	node: FlowNode;
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
	// The devices this node may name, as the Host says. A node with a
	// profile runs on the profile's device and names none of its own.
	const named = "profile" in node ? node.profile : undefined;
	const profile = typeof named === "string" ? named : undefined;
	const onDevice = runsOnDevice(node) && !isProfileRef(named);
	const nodeDevices = useQuery({
		...runQueries.devices(projectId, profile !== undefined ? { profile } : {}),
		enabled: onDevice,
		meta: { quietErrors: true },
	});
	const { label: typeLabel, icon: Icon } = nodeMeta(node);

	return (
		<div className="flex flex-col">
			<div className="flex items-center gap-3 p-4 pb-3">
				<div className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
					<Icon className="size-4" aria-hidden="true" />
				</div>
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<h2 className="min-w-0">
						<Input
							aria-label="Label"
							title="The name on the canvas"
							value={node.label ?? ""}
							placeholder={node.id}
							autoComplete="off"
							className="-mx-1.5 h-7 w-[calc(100%+0.75rem)] border-transparent bg-transparent px-1.5 font-semibold text-base shadow-none hover:border-input focus-visible:border-input md:text-base dark:bg-transparent"
							onChange={(event) => {
								const label = event.target.value;
								onChange((current) => ({
									...current,
									label: label || undefined,
								}));
							}}
						/>
					</h2>
					<div className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
						<span className="shrink-0">{typeLabel}</span>
						<span aria-hidden="true">·</span>
						<IdField
							key={node.id}
							id={`${id}-id`}
							nodeId={node.id}
							onRename={onRename}
						/>
						{isStart ? (
							<Badge variant="secondary" className="h-4 shrink-0 px-1.5">
								<PlayIcon aria-hidden="true" />
								Start
							</Badge>
						) : null}
					</div>
				</div>
				<div className="flex shrink-0 items-center">
					{isStart ? null : (
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={onSetStart}
							aria-label="Set as start"
							title="Start the run here"
						>
							<PlayIcon />
						</Button>
					)}
					<Button
						variant="ghost"
						size="icon-sm"
						className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
						onClick={onDelete}
						aria-label={`Delete ${node.id}`}
						title="Delete node (Backspace)"
					>
						<Trash2Icon />
					</Button>
				</div>
			</div>

			<InspectorTabs>
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
						flow={flow}
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
						projectId={projectId}
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
						projectId={projectId}
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

				{node.type === "end" ? (
					<EndFields
						flow={flow}
						node={node}
						onChange={(change) =>
							onChange((current) =>
								current.type === "end" ? change(current) : current,
							)
						}
					/>
				) : null}

				{node.type === "join" ? (
					<JoinFields
						node={node}
						onChange={(change) =>
							onChange((current) =>
								current.type === "join" ? change(current) : current,
							)
						}
					/>
				) : null}

				{node.type === "agent" ? (
					<AgentAdvanced
						projectId={projectId}
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

				{onDevice ? (
					<InspectorSection
						title="Device"
						tab="setup"
						defaultOpen={"device" in node && node.device !== undefined}
					>
						<DeviceField
							id={`${id}-device`}
							value={"device" in node ? node.device : undefined}
							devices={nodeDevices.data}
							onChange={(device) =>
								onChange((current) => withDevice(current, device))
							}
						/>
					</InspectorSection>
				) : null}

				{/* A Gate (a Decision decided by you) has a deadline instead of limits; an End and a Join take no time. */}
				{(node.type === "decision" && node.by === "person") ||
				node.type === "end" ||
				node.type === "join" ? null : (
					<InspectorSection
						title="Limits"
						tab="setup"
						defaultOpen={
							node.timeoutMinutes !== undefined ||
							(node.type === "agent" &&
								(node.idleMinutes !== undefined || node.maxTurns !== undefined))
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
									placeholder="From the run policy"
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
						{node.type === "agent" ? (
							<Field
								id={`${id}-max-turns`}
								label="Max turns"
								optional
								hint="A turn is one reply of the agent. The step fails when the agent takes more."
							>
								<PositiveIntInput
									id={`${id}-max-turns`}
									value={node.maxTurns}
									placeholder="From the run policy"
									describedBy={`${id}-max-turns-hint`}
									onChange={(maxTurns) =>
										onChange((current) =>
											current.type === "agent"
												? { ...current, maxTurns }
												: current,
										)
									}
								/>
							</Field>
						) : null}
					</InspectorSection>
				)}
			</InspectorTabs>
		</div>
	);
}

/**
 * The node's id, in the header. Commits on blur or Enter, so the edges
 * follow one rename and not every keystroke.
 */
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
		<>
			<input
				id={id}
				aria-label="Id"
				title={`Later nodes use its outputs as {{${nodeId}.field}}. Renaming it updates every edge and reference.`}
				value={text}
				size={Math.max(text.length, 2)}
				className="min-w-0 max-w-full rounded-sm bg-transparent px-0.5 font-mono text-foreground outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-1 focus-visible:ring-ring aria-invalid:text-destructive"
				autoComplete="off"
				spellCheck={false}
				aria-invalid={error !== null}
				aria-describedby={error ? `${id}-error` : undefined}
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
			{error ? (
				<span
					id={`${id}-error`}
					role="alert"
					className="truncate text-destructive"
				>
					{error}
				</span>
			) : null}
		</>
	);
}
