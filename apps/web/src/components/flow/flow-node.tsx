import {
	type AgentNode,
	type DecisionNode,
	type FlowNode,
	type FlowNodeType,
	type GateNode,
	nodeOutcomes,
} from "@nightshift/flows";
import { cn } from "@nightshift/ui/lib/utils";
import {
	Handle,
	type Node,
	type NodeProps,
	type NodeTypes,
	Position,
	useUpdateNodeInternals,
} from "@xyflow/react";
import {
	CircleAlertIcon,
	GitPullRequestIcon,
	PlayIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { memo, useEffect, useRef } from "react";

import {
	OutcomeBadge,
	outcomeLabel,
	outcomeStyle,
	type StepState,
	stepStateStyle,
} from "@/components/outcome-badge";
import { agentSummary, firstLine } from "@/lib/flow-draft";

import { NODE_TYPE } from "./node-type";

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

/** The descriptions of a node's options, by name, to show beside their handles. */
function optionDescriptions(node: FlowNode): Map<string, string | undefined> {
	const options =
		node.type === "decision"
			? node.labels
			: node.type === "gate"
				? node.choices
				: [];
	return new Map(options.map((option) => [option.name, option.description]));
}

const FlowNodeCard = memo(function FlowNodeCard({
	id,
	data,
	selected,
	isConnectable,
}: NodeProps<FlowCanvasNode>) {
	const { node, isStart, errorCount, warningCount, run } = data;
	const meta = NODE_TYPE[node.type];
	const Icon = meta.icon;
	const runColor = run ? stepStateStyle(run.state).color : undefined;
	const active = run?.state === "running";
	const waiting = run?.state === "waiting";

	// One handle per outcome, unique by name (a draft can repeat a label).
	const outcomes = [...new Set(nodeOutcomes(node))];
	const descriptions = optionDescriptions(node);
	// Labels and choices come and go: React Flow must measure the handles again,
	// or edges on a renamed handle do not find it.
	// On mount React Flow measures them anyway, so only a change after it counts.
	const updateNodeInternals = useUpdateNodeInternals();
	const outcomesKey = outcomes.join("\u0000");
	const measuredKey = useRef(outcomesKey);
	useEffect(() => {
		if (measuredKey.current === outcomesKey) return;
		measuredKey.current = outcomesKey;
		updateNodeInternals(id);
	}, [id, outcomesKey, updateNodeInternals]);

	return (
		<div
			className={cn(
				"relative w-60 border bg-card text-card-foreground text-xs shadow-xs transition-[box-shadow,opacity] motion-reduce:transition-none",
				selected && "border-foreground/50 ring-1 ring-ring",
				errorCount > 0 && "border-destructive/70",
				active &&
					"shadow-[0_0_0_2px_var(--status-running),0_0_16px_0_color-mix(in_oklch,var(--status-running)_40%,transparent)]",
				waiting &&
					"shadow-[0_0_0_2px_var(--status-waiting),0_0_20px_2px_color-mix(in_oklch,var(--status-waiting)_45%,transparent)]",
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
				{node.type === "decision" ? <DecisionBody node={node} /> : null}
				{node.type === "gate" ? <GateBody node={node} /> : null}
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

			<ul
				className="flex flex-col border-t py-1"
				aria-label={
					node.type === "decision"
						? "Labels"
						: node.type === "gate"
							? "Choices"
							: "Outcomes"
				}
			>
				{outcomes.length === 0 ? (
					<li className="flex h-5 items-center justify-end pr-3.5 text-[11px] text-muted-foreground italic">
						{node.type === "decision" ? "No labels yet" : "No choices yet"}
					</li>
				) : null}
				{outcomes.map((outcome) => {
					const style = outcomeStyle(outcome);
					const description = descriptions.get(outcome);
					return (
						<li
							key={outcome}
							className="relative flex h-5 items-center justify-end gap-2 pr-3.5 pl-2 text-[11px]"
							title={description}
						>
							{description ? (
								<span className="min-w-0 flex-1 truncate text-muted-foreground">
									{description}
								</span>
							) : null}
							<span className={cn("shrink-0 font-medium", style.text)}>
								{outcomeLabel(outcome)}
							</span>
							<Handle
								type="source"
								id={outcome}
								position={Position.Right}
								isConnectable={isConnectable}
								className="size-3 border-2 border-card"
								style={{ background: style.color }}
								title={`Drag to connect the ${outcomeLabel(outcome)} outcome`}
							/>
						</li>
					);
				})}
			</ul>
		</div>
	);
});

/** A small "GitHub" mark when the node has the GitHub tools. */
function GitHubTools({ tools }: { tools: readonly string[] }) {
	if (!tools.includes("github")) return null;
	return (
		<>
			{" · "}
			<span
				className="inline-flex items-center gap-0.5 align-bottom text-foreground/80"
				title="Has the GitHub tools"
			>
				<GitPullRequestIcon className="size-3" aria-hidden="true" />
				GitHub
			</span>
		</>
	);
}

function AgentBody({ node }: { node: AgentNode }) {
	const summary = agentSummary(node);
	return (
		<>
			<span className="truncate text-[11px] text-muted-foreground">
				{node.model}
				{node.effort ? ` · ${node.effort}` : ""}
				{node.session === "resume" ? " · resumes session" : ""}
				<GitHubTools tools={node.tools ?? []} />
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

function DecisionBody({ node }: { node: DecisionNode }) {
	const summary = firstLine(node.prompt);
	return (
		<>
			<span className="truncate text-[11px] text-muted-foreground">
				{node.model}
				<GitHubTools tools={node.tools ?? []} />
			</span>
			<p
				className={cn(
					"line-clamp-2 break-words",
					summary === "" && "text-muted-foreground italic",
				)}
			>
				{summary === "" ? "No prompt yet" : summary}
			</p>
		</>
	);
}

function GateBody({ node }: { node: GateNode }) {
	const question = node.question.trim();
	return (
		<p
			className={cn(
				"line-clamp-3 whitespace-pre-line break-words",
				question === "" && "text-muted-foreground italic",
			)}
		>
			{question === "" ? "No question yet" : question}
		</p>
	);
}

export const nodeTypes: NodeTypes = {
	agent: FlowNodeCard,
	command: FlowNodeCard,
	decision: FlowNodeCard,
	gate: FlowNodeCard,
} satisfies Record<FlowNodeType, unknown>;
