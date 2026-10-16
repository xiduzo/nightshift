import {
	type AgentNode,
	type DecisionNode,
	type FlowNode,
	type FlowNodeType,
	type ForEachNode,
	type GateNode,
	type ListSource,
	nodeOutcomes,
	type SubflowNode,
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
	BracesIcon,
	CircleAlertIcon,
	FilesIcon,
	GitBranchIcon,
	ListTreeIcon,
	PlayIcon,
	SquareTerminalIcon,
	TriangleAlertIcon,
	WorkflowIcon,
	WrenchIcon,
} from "lucide-react";
import { memo, useContext, useEffect, useRef } from "react";

import {
	OutcomeBadge,
	outcomeLabel,
	outcomeStyle,
	type StepState,
	stepStateStyle,
} from "@/components/outcome-badge";
import { agentSummary, firstLine, sourceSummary } from "@/lib/flow-draft";

import { NODE_TYPE } from "./node-type";
import { OpenFlowContext } from "./open-flow-context";

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
	if (node.type === "foreach") {
		return new Map([
			["done", "No element left to start"],
			[
				"halted",
				node.haltOn.length > 0
					? `A call ended on ${node.haltOn.join(", ")}`
					: undefined,
			],
		]);
	}
	if (node.type === "subflow") {
		return new Map([
			["pass", "It finished"],
			["fail", "It failed"],
		]);
	}
	const options =
		node.type === "decision"
			? node.labels
			: node.type === "gate"
				? node.choices
				: node.type === "agent"
					? (node.outcomes ?? [])
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
				{node.type === "subflow" ? <SubflowBody node={node} /> : null}
				{node.type === "foreach" ? <ForEachBody node={node} /> : null}
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

/** A small mark per tool set the node has. */
function ToolSets({ tools }: { tools: readonly string[] }) {
	if (tools.length === 0) return null;
	return (
		<>
			{" · "}
			<span
				className="inline-flex items-center gap-0.5 align-bottom font-mono text-foreground/80"
				title={`Tool sets: ${tools.join(", ")}`}
			>
				<WrenchIcon className="size-3" aria-hidden="true" />
				{tools.join(", ")}
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
				{node.output ? " · data schema" : ""}
				<ToolSets tools={node.tools ?? []} />
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
				<ToolSets tools={node.tools ?? []} />
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

/** The called flow's name: a link in the editor, plain text elsewhere. */
function CalledFlowName({ name, prefix }: { name: string; prefix: string }) {
	const openFlow = useContext(OpenFlowContext);
	return (
		<span className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
			<WorkflowIcon className="size-3 shrink-0" aria-hidden="true" />
			<span className="shrink-0">{prefix}</span>
			{name === "" ? (
				<span className="italic">no flow picked yet</span>
			) : openFlow ? (
				<button
					type="button"
					className="nodrag nopan min-w-0 truncate font-mono text-foreground underline decoration-foreground/30 underline-offset-2 outline-none hover:decoration-foreground focus-visible:ring-1 focus-visible:ring-ring"
					title={`Open the flow ${name}`}
					onClick={(event) => {
						event.stopPropagation();
						openFlow(name);
					}}
				>
					{name}
				</button>
			) : (
				<span className="min-w-0 truncate font-mono text-foreground">
					{name}
				</span>
			)}
		</span>
	);
}

/** The inputs bound by templates, one per line: `epic ← {{epic}}`. */
function Bindings({ bindings }: { bindings: Record<string, string> }) {
	const entries = Object.entries(bindings);
	if (entries.length === 0) return null;
	return (
		<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-1.5 gap-y-0.5 bg-muted/60 px-1.5 py-1 font-mono text-[11px]">
			{entries.slice(0, 4).map(([name, value]) => (
				<div key={name} className="contents">
					<dt className="text-muted-foreground">{name} ←</dt>
					<dd className="truncate" title={value}>
						{value}
					</dd>
				</div>
			))}
			{entries.length > 4 ? (
				<dd className="col-span-2 text-muted-foreground">
					+{entries.length - 4} more
				</dd>
			) : null}
		</dl>
	);
}

/** Which flow it calls, and the inputs it binds. */
function SubflowBody({ node }: { node: SubflowNode }) {
	return (
		<>
			<CalledFlowName name={node.flow} prefix="Runs" />
			<Bindings bindings={node.inputs} />
		</>
	);
}

const SOURCE_ICON: Record<ListSource["kind"], typeof BracesIcon> = {
	json: BracesIcon,
	command: SquareTerminalIcon,
	files: FilesIcon,
	github: ListTreeIcon,
};

const SOURCE_EMPTY: Record<ListSource["kind"], string> = {
	json: "No list yet",
	command: "No source command yet",
	files: "No glob yet",
	github: "No parent issue yet",
};

/** Where the elements come from, which flow runs per element, and on which branch. */
function ForEachBody({ node }: { node: ForEachNode }) {
	const summary = sourceSummary(node.source);
	const SourceIcon = SOURCE_ICON[node.source.kind];
	const code = node.source.kind !== "github";
	return (
		<>
			<p
				className={cn(
					"flex min-w-0 items-center gap-1.5 bg-muted/60 px-1.5 py-1 text-[11px]",
					code && "font-mono",
				)}
				title={summary}
			>
				<SourceIcon
					className="size-3 shrink-0 text-muted-foreground"
					aria-label={`From ${node.source.kind}`}
				/>
				{summary === "" ? (
					<span className="font-sans text-muted-foreground italic">
						{SOURCE_EMPTY[node.source.kind]}
					</span>
				) : (
					<span className="truncate">
						{node.source.kind === "command" ? (
							<span className="text-muted-foreground" aria-hidden="true">
								${" "}
							</span>
						) : null}
						{summary}
					</span>
				)}
			</p>
			<CalledFlowName name={node.flow} prefix="Each runs" />
			<span className="truncate font-mono text-[11px] text-muted-foreground">
				as {node.as}
				{Object.keys(node.inputs).length > 0
					? ` · binds ${Object.keys(node.inputs).join(", ")}`
					: ""}
			</span>
			<span className="flex min-w-0 items-center gap-1 truncate text-[11px] text-muted-foreground">
				<GitBranchIcon className="size-3 shrink-0" aria-hidden="true" />
				{node.branch === "per-item"
					? "Branch per element"
					: "One shared branch"}
				{node.maxItems ? ` · max ${node.maxItems}` : ""}
			</span>
		</>
	);
}

export const nodeTypes: NodeTypes = {
	agent: FlowNodeCard,
	command: FlowNodeCard,
	decision: FlowNodeCard,
	gate: FlowNodeCard,
	subflow: FlowNodeCard,
	foreach: FlowNodeCard,
} satisfies Record<FlowNodeType, unknown>;
