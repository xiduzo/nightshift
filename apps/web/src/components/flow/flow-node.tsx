import {
	type FlowNode,
	type FlowNodeType,
	outcomesByType,
} from "@nightshift/flows";
import { cn } from "@nightshift/ui/lib/utils";
import {
	Handle,
	type Node,
	type NodeProps,
	type NodeTypes,
	Position,
} from "@xyflow/react";
import {
	BotIcon,
	CircleAlertIcon,
	PlayIcon,
	SquareTerminalIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { memo } from "react";

import {
	OutcomeBadge,
	outcomeLabel,
	STEP_STATE,
	type StepState,
} from "@/components/outcome-badge";
import { agentSummary } from "@/lib/flow-draft";

export type NodeRunState = {
	/** The state of the node's latest step. */
	state: StepState;
	visits: number;
};

export type FlowNodeData = {
	node: FlowNode;
	isStart: boolean;
	errorCount: number;
	warningCount: number;
	/** Run view only: the node's latest step, or null when the run never reached it. */
	run?: NodeRunState | null;
};

export type FlowCanvasNode = Node<FlowNodeData, FlowNodeType>;

const TYPE_META: Record<FlowNodeType, { label: string; icon: typeof BotIcon }> =
	{
		agent: { label: "Agent", icon: BotIcon },
		command: { label: "Command", icon: SquareTerminalIcon },
	};

const FlowNodeCard = memo(function FlowNodeCard({
	data,
	selected,
	isConnectable,
}: NodeProps<FlowCanvasNode>) {
	const { node, isStart, errorCount, warningCount, run } = data;
	const meta = TYPE_META[node.type];
	const Icon = meta.icon;
	const runColor = run ? STEP_STATE[run.state].color : undefined;
	const active = run?.state === "running";

	return (
		<div
			className={cn(
				"relative w-60 border bg-card text-card-foreground text-xs shadow-xs transition-[box-shadow,opacity] motion-reduce:transition-none",
				selected && "border-foreground/50 ring-1 ring-ring",
				errorCount > 0 && "border-destructive/70",
				active &&
					"shadow-[0_0_0_2px_var(--status-running),0_0_16px_0_color-mix(in_oklch,var(--status-running)_40%,transparent)]",
				run === null && "opacity-55",
			)}
			style={
				runColor ? { borderLeftColor: runColor, borderLeftWidth: 3 } : undefined
			}
		>
			<Handle
				type="target"
				position={Position.Left}
				isConnectable={isConnectable}
				className="size-3 border-2 border-card bg-muted-foreground"
				style={{ top: 17 }}
			/>
			<div className="flex min-w-0 items-center gap-1.5 border-b px-2 py-1.5">
				<Icon
					className="size-3.5 shrink-0 text-muted-foreground"
					aria-label={meta.label}
				/>
				<span className="min-w-0 flex-1 truncate font-medium">
					{node.label || node.id}
				</span>
				{isStart ? (
					<span
						className="flex shrink-0 items-center gap-0.5 border border-foreground/20 bg-muted px-1 text-[10px] text-muted-foreground uppercase tracking-wide"
						title="The run starts here"
					>
						<PlayIcon className="size-2.5" aria-hidden="true" />
						Start
					</span>
				) : null}
				{errorCount > 0 ? (
					<span
						className="flex shrink-0 items-center gap-0.5 text-destructive"
						title={`${errorCount} ${errorCount === 1 ? "error" : "errors"}`}
					>
						<CircleAlertIcon className="size-3.5" aria-hidden="true" />
						<span className="sr-only">Errors:</span>
						{errorCount}
					</span>
				) : warningCount > 0 ? (
					<span
						className="flex shrink-0 items-center gap-0.5 text-status-interrupted"
						title={`${warningCount} ${warningCount === 1 ? "warning" : "warnings"}`}
					>
						<TriangleAlertIcon className="size-3.5" aria-hidden="true" />
						<span className="sr-only">Warnings:</span>
						{warningCount}
					</span>
				) : null}
			</div>

			<div className="flex min-w-0 flex-col gap-1 px-2 py-1.5">
				{node.label ? (
					<span className="truncate font-mono text-[11px] text-muted-foreground">
						{node.id}
					</span>
				) : null}
				{node.type === "agent" ? <AgentBody node={node} /> : null}
				{node.type === "command" ? (
					<code className="block truncate bg-muted/60 px-1.5 py-1 font-mono text-[11px]">
						{node.command.trim() === "" ? (
							<span className="text-muted-foreground italic">
								No command yet
							</span>
						) : (
							<>
								<span className="text-muted-foreground" aria-hidden="true">
									${" "}
								</span>
								{node.command}
							</>
						)}
					</code>
				) : null}
				{run ? (
					<div className="flex items-center gap-1.5 pt-0.5">
						<OutcomeBadge state={run.state} />
						{run.visits > 1 ? (
							<span className="text-muted-foreground">{run.visits} visits</span>
						) : null}
					</div>
				) : null}
			</div>

			<ul className="flex flex-col border-t py-1" aria-label="Outcomes">
				{outcomesByType[node.type].map((outcome) => (
					<li
						key={outcome}
						className="relative flex h-5 items-center justify-end pr-3.5 text-[11px]"
					>
						<span className={STEP_STATE[outcome].text}>
							{outcomeLabel(outcome)}
						</span>
						<Handle
							type="source"
							id={outcome}
							position={Position.Right}
							isConnectable={isConnectable}
							className="size-3 border-2 border-card"
							style={{ background: STEP_STATE[outcome].color }}
							title={`Drag to connect the ${outcomeLabel(outcome)} outcome`}
						/>
					</li>
				))}
			</ul>
		</div>
	);
});

function AgentBody({ node }: { node: Extract<FlowNode, { type: "agent" }> }) {
	const summary = agentSummary(node);
	return (
		<>
			<span className="truncate text-[11px] text-muted-foreground">
				{node.model}
				{node.effort ? ` · ${node.effort}` : ""}
				{node.session === "resume" ? " · resumes session" : ""}
			</span>
			<p
				className={cn(
					"line-clamp-2 break-words",
					node.skill && "font-mono text-[11px]",
					summary === "" && "text-muted-foreground italic",
				)}
			>
				{summary === "" ? "No prompt yet" : summary}
			</p>
		</>
	);
}

export const nodeTypes: NodeTypes = {
	agent: FlowNodeCard,
	command: FlowNodeCard,
};
