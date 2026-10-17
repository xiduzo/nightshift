import {
	type AgentNode,
	type CallEachNode,
	type CallNode,
	type DecisionNode,
	type FlowNode,
	type FlowNodeType,
	type ListSource,
	nodeOutcomes,
	runsEach,
} from "@nightshift/flows";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import { cn } from "@nightshift/ui/lib/utils";
import {
	Handle,
	type Node,
	type NodeProps,
	type NodeTypes,
	Position,
	type ReactFlowState,
	useStore,
	useUpdateNodeInternals,
} from "@xyflow/react";
import {
	BracesIcon,
	CircleAlertIcon,
	FilesIcon,
	GitBranchIcon,
	PlayIcon,
	SquareTerminalIcon,
	TriangleAlertIcon,
	WorkflowIcon,
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
import { harnessInfo } from "@/lib/harnesses";

import { CALL_EACH_ICON, DECIDED_BY_ICON, NODE_TYPE } from "./node-type";
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
	if (runsEach(node)) {
		return new Map([
			["done", "No item left to start"],
			[
				"halted",
				node.each.haltOn.length > 0
					? `A call ended on ${node.each.haltOn.join(", ")}`
					: undefined,
			],
		]);
	}
	if (node.type === "call") {
		return new Map([
			["pass", "It finished"],
			["fail", "It failed"],
		]);
	}
	const options =
		node.type === "decision"
			? node.options
			: node.type === "agent"
				? (node.outcomes ?? [])
				: [];
	return new Map(options.map((option) => [option.name, option.description]));
}

/** Below this zoom a node's text is too small to read, so the node shows its
 *  type and id in large type instead, and a big flow reads as an overview. */
const OVERVIEW_ZOOM = 0.55;
/** The id's size on screen in the overview, and the most it may take up in
 *  the node. */
const OVERVIEW_TEXT = 14;
const OVERVIEW_TEXT_MAX = 44;

/** The zoom in steps of 0.05 below `OVERVIEW_ZOOM`, else null: a node redraws
 *  a few times in a zoom gesture, not on every frame. */
function overviewZoom(state: ReactFlowState): number | null {
	const zoom = state.transform[2];
	return zoom < OVERVIEW_ZOOM
		? Math.max(0.05, Math.round(zoom * 20) / 20)
		: null;
}

const FlowNodeCard = memo(function FlowNodeCard({
	id,
	data,
	selected,
	isConnectable,
}: NodeProps<FlowCanvasNode>) {
	const { node, isStart, errorCount, warningCount, run } = data;
	const meta = NODE_TYPE[node.type];
	const Icon =
		node.type === "decision"
			? DECIDED_BY_ICON[node.by]
			: runsEach(node)
				? CALL_EACH_ICON
				: meta.icon;
	const runColor = run ? stepStateStyle(run.state).color : undefined;
	const active = run?.state === "running";
	const waiting = run?.state === "waiting";

	// One handle per outcome, unique by name (a draft can repeat a label).
	const outcomes = [...new Set(nodeOutcomes(node))];
	const descriptions = optionDescriptions(node);
	// Options come and go: React Flow must measure the handles again,
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

	const label = node.label?.trim();
	const overview = useStore(overviewZoom);
	const overviewText = overview
		? Math.min(OVERVIEW_TEXT / overview, OVERVIEW_TEXT_MAX)
		: 0;

	return (
		<div
			className={cn(
				"relative w-64 rounded-lg border bg-card text-card-foreground text-xs shadow-xs transition-[box-shadow,opacity,border-color] motion-reduce:transition-none",
				selected && "ring-2 ring-ring",
				errorCount > 0 && "border-destructive",
				active &&
					"shadow-[0_0_0_1px_var(--status-running),0_0_18px_0_color-mix(in_oklch,var(--status-running)_35%,transparent)]",
				waiting &&
					"shadow-[0_0_0_1px_var(--status-waiting),0_0_20px_2px_color-mix(in_oklch,var(--status-waiting)_40%,transparent)]",
				run === null && "opacity-55",
			)}
			style={
				runColor ? { borderLeftColor: runColor, borderLeftWidth: 4 } : undefined
			}
		>
			<Handle
				type="target"
				position={Position.Left}
				isConnectable={isConnectable}
				className="size-2.5! min-h-0! min-w-0! border-2! border-card! bg-muted-foreground!"
				style={{ top: 20 }}
			/>
			{/* Kept in the overview, only hidden: the node keeps its size, so
			    the layout and the edges stay where they are. */}
			<div className={cn(overview && "invisible")}>
				<div className="flex min-w-0 flex-col gap-0.5 px-3 pt-2.5 pb-2">
					<div className="flex h-5 min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground uppercase tracking-wider">
						<Icon className="size-3.5 shrink-0" aria-hidden="true" />
						<span className="truncate">{meta.label}</span>
						{isStart ? (
							<Badge
								variant="outline"
								className="h-4 gap-0.5 px-1.5 font-mono text-[10px] text-foreground lowercase tracking-normal"
								title="The run starts here"
							>
								<PlayIcon aria-hidden="true" />
								start
							</Badge>
						) : null}
						<span className="ml-auto flex shrink-0 items-center gap-1.5 normal-case tracking-normal">
							{errorCount > 0 ? (
								<Badge
									variant="destructive"
									className="h-4 gap-0.5 px-1.5 text-[10px] tabular-nums"
									title={`${errorCount} ${errorCount === 1 ? "error" : "errors"}`}
								>
									<CircleAlertIcon aria-hidden="true" />
									<span className="sr-only">Errors:</span>
									{errorCount}
								</Badge>
							) : warningCount > 0 ? (
								<Badge
									variant="outline"
									className="h-4 gap-0.5 border-status-waiting/40 bg-status-waiting/10 px-1.5 text-[10px] text-status-waiting tabular-nums"
									title={`${warningCount} ${warningCount === 1 ? "warning" : "warnings"}`}
								>
									<TriangleAlertIcon aria-hidden="true" />
									<span className="sr-only">Warnings:</span>
									{warningCount}
								</Badge>
							) : null}
							{run ? (
								<OutcomeBadge
									state={run.state}
									className="h-4 px-1.5 text-[10px]"
								/>
							) : null}
						</span>
					</div>
					<span
						className="truncate font-medium font-mono text-sm leading-6"
						title={node.id}
					>
						{node.id}
					</span>
					{label && label !== node.id ? (
						<span className="truncate text-muted-foreground" title={label}>
							{label}
						</span>
					) : null}
				</div>

				<div className="flex min-w-0 flex-col gap-1.5 border-t px-3 py-2">
					{node.type === "agent" ? <AgentBody node={node} /> : null}
					{node.type === "decision" ? <DecisionBody node={node} /> : null}
					{node.type === "call" ? (
						runsEach(node) ? (
							<EachBody node={node} />
						) : (
							<CallBody node={node} />
						)
					) : null}
					{node.type === "command" ? (
						<code className="block truncate rounded-md bg-muted px-2 py-1 font-mono text-[11px]">
							{node.command.trim() === "" ? (
								<span className="font-sans text-muted-foreground italic">
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
					{run && run.visits > 1 ? (
						<span className="text-[11px] text-muted-foreground tabular-nums">
							{run.visits} visits
						</span>
					) : null}
				</div>

				<ul
					className="flex flex-col border-t py-1"
					aria-label={node.type === "decision" ? "Options" : "Outcomes"}
				>
					{outcomes.length === 0 ? (
						<li className="flex h-5 items-center justify-end pr-3.5 text-[11px] text-muted-foreground italic">
							No options yet
						</li>
					) : null}
					{outcomes.map((outcome) => {
						const style = outcomeStyle(outcome);
						const description = descriptions.get(outcome);
						return (
							<li
								key={outcome}
								className="relative flex h-5 items-center justify-end gap-2 pr-3.5 pl-3 text-[11px]"
								title={description}
							>
								{description ? (
									<span className="min-w-0 flex-1 truncate text-muted-foreground">
										{description}
									</span>
								) : null}
								<span
									className={cn("shrink-0 font-medium font-mono", style.text)}
								>
									{outcomeLabel(outcome)}
								</span>
								<Handle
									type="source"
									id={outcome}
									position={Position.Right}
									isConnectable={isConnectable}
									className="size-2.5! min-h-0! min-w-0! border-2! border-card!"
									style={{ background: style.color }}
									title={`Drag to connect the ${outcomeLabel(outcome)} outcome`}
								/>
							</li>
						);
					})}
				</ul>
			</div>
			{overview ? (
				<div
					className="absolute inset-0 flex flex-col items-center justify-center gap-[0.3em] overflow-hidden p-3 text-center"
					style={{ fontSize: overviewText }}
				>
					<Icon
						className="size-[0.9em] shrink-0 text-muted-foreground"
						aria-hidden="true"
					/>
					<span className="line-clamp-3 break-all font-medium font-mono leading-tight">
						{node.id}
					</span>
				</div>
			) : null}
		</div>
	);
});

/** A small mark with the CLI tools the node may run. */
function CliTools({ tools }: { tools: readonly string[] }) {
	if (tools.length === 0) return null;
	return (
		<>
			{" · "}
			<span
				className="inline-flex items-center gap-0.5 align-bottom font-mono text-foreground/80"
				title={`CLI tools: ${tools.join(", ")}`}
			>
				<SquareTerminalIcon className="size-3" aria-hidden="true" />
				{tools.join(", ")}
			</span>
		</>
	);
}

/**
 * What the node sets itself: its harness (unless the default Claude Code
 * without a profile), model and effort. A profile's own values show on the
 * Agents page, not here.
 */
function agentParts(node: AgentNode): string[] {
	const parts: string[] = [];
	if (
		node.harness !== undefined &&
		(node.harness !== "claude-code" || node.profile !== undefined)
	) {
		parts.push(harnessInfo(node.harness).label);
	}
	if (node.model !== undefined) parts.push(node.model);
	if (node.effort !== undefined) parts.push(node.effort);
	return parts;
}

function AgentBody({ node }: { node: AgentNode }) {
	const summary = agentSummary(node);
	return (
		<>
			<span className="truncate text-[11px] text-muted-foreground">
				{node.profile !== undefined ? (
					<span className="font-mono text-foreground/80">{node.profile}</span>
				) : null}
				{agentParts(node)
					.map((part, i) =>
						i === 0 && node.profile === undefined ? part : ` · ${part}`,
					)
					.join("")}
				{node.session === "resume" ? " · resumes session" : ""}
				{node.output ? " · data schema" : ""}
				<CliTools tools={node.clis ?? []} />
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

/** Who decides, then the prompt: the question for you, the brief for a model, a note for a rule. */
function DecisionBody({ node }: { node: DecisionNode }) {
	const summary = firstLine(node.prompt);
	const who =
		node.by === "person"
			? "You decide"
			: node.by === "rule"
				? "A rule decides"
				: `A model decides${node.model ? ` · ${node.model}` : ""}`;
	const empty =
		node.by === "person"
			? "No question yet"
			: node.by === "rule"
				? "No note"
				: "No prompt yet";
	return (
		<>
			<span className="truncate text-[11px] text-muted-foreground">{who}</span>
			<p
				className={cn(
					"line-clamp-2 break-words",
					summary === "" && "text-muted-foreground italic",
				)}
			>
				{summary === "" ? empty : summary}
			</p>
		</>
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
				<Button
					variant="link"
					size="xs"
					className="nodrag nopan h-auto min-w-0 justify-start truncate px-0 font-mono text-[11px] text-foreground underline decoration-foreground/30 hover:decoration-foreground"
					title={`Open the flow ${name}`}
					onClick={(event) => {
						event.stopPropagation();
						openFlow(name);
					}}
				>
					<span className="truncate">{name}</span>
				</Button>
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
		<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-1.5 gap-y-0.5 rounded-md bg-muted px-2 py-1 font-mono text-[11px]">
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

/** A Call that runs once: which flow it calls, and the inputs it binds. */
function CallBody({ node }: { node: CallNode }) {
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
};

const SOURCE_EMPTY: Record<ListSource["kind"], string> = {
	json: "No list yet",
	command: "No source command yet",
	files: "No file pattern yet",
};

/** A Call that runs once per item: where the items come from, which flow runs per item, and on which branch. */
function EachBody({ node }: { node: CallEachNode }) {
	const { each } = node;
	const summary = sourceSummary(each.source);
	const SourceIcon = SOURCE_ICON[each.source.kind];
	return (
		<>
			<p
				className="flex min-w-0 items-center gap-1.5 rounded-md bg-muted px-2 py-1 font-mono text-[11px]"
				title={summary}
			>
				<SourceIcon
					className="size-3 shrink-0 text-muted-foreground"
					aria-label={`From ${each.source.kind}`}
				/>
				{summary === "" ? (
					<span className="font-sans text-muted-foreground italic">
						{SOURCE_EMPTY[each.source.kind]}
					</span>
				) : (
					<span className="truncate">
						{each.source.kind === "command" ? (
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
				as {each.as}
				{Object.keys(node.inputs).length > 0
					? ` · binds ${Object.keys(node.inputs).join(", ")}`
					: ""}
			</span>
			<span className="flex min-w-0 items-center gap-1 truncate text-[11px] text-muted-foreground">
				<GitBranchIcon className="size-3 shrink-0" aria-hidden="true" />
				{each.branch === "per-item" ? "Branch per item" : "One shared branch"}
				{each.maxItems ? ` · max ${each.maxItems}` : ""}
			</span>
		</>
	);
}

export const nodeTypes: NodeTypes = {
	agent: FlowNodeCard,
	command: FlowNodeCard,
	decision: FlowNodeCard,
	call: FlowNodeCard,
} satisfies Record<FlowNodeType, unknown>;
