import {
	commandExits,
	type FlowIssue,
	type FlowNode,
	type FlowNodeType,
	nodeOutcomes,
	outcomeColor,
	runsEach,
	type WaitUntil,
} from "@nightshift/flows";
import { Badge } from "@nightshift/ui/components/badge";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
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
	CircleAlertIcon,
	PlayIcon,
	TriangleAlertIcon,
	VariableIcon,
} from "lucide-react";
import { memo, useEffect, useRef } from "react";
import {
	AgentBody,
	CallBody,
	DecisionBody,
	EachBody,
	ToolBody,
	ValueBody,
	WaitBody,
} from "./node-bodies";
import {
	CALL_EACH_ICON,
	DECIDED_BY_ICON,
	NODE_TYPE,
	VALUE_BY_ICON,
} from "./node-type";
import {
	OutcomeBadge,
	outcomeLabel,
	outcomeStyle,
	type StepState,
	stepStateStyle,
} from "./outcome-badge";

export type NodeRunState = {
	/** The state of the node's latest step. */
	state: StepState;
	visits: number;
};

export type FlowNodeData = {
	node: FlowNode;
	isStart: boolean;
	/** The node's issues. The badge counts them and its tooltip lists them. */
	issues: readonly FlowIssue[];
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
			["stopped", "The stop time came"],
		]);
	}
	if (node.type === "call") {
		return new Map([
			["pass", "It finished"],
			["fail", "It failed"],
			["stopped", "The stop time came"],
		]);
	}
	if (node.type === "value") {
		return new Map([
			["pass", "The data fits"],
			["fail", "No value made"],
		]);
	}
	if (node.type === "wait") {
		return new Map([
			["done", WAIT_DONE[node.until.kind]],
			[
				"timeout",
				node.timeoutMinutes
					? `Not within ${node.timeoutMinutes} min`
					: "Never: it has no timeout",
			],
		]);
	}
	if (node.type === "tool") {
		return new Map([
			["pass", "The tool answered"],
			["fail", "It reported an error"],
		]);
	}
	if (node.type === "command") {
		return new Map(
			commandExits(node).map((exit) => [
				exit.name,
				exit.code === undefined ? "any other exit" : `exit ${exit.code}`,
			]),
		);
	}
	const options =
		node.type === "decision"
			? node.options
			: node.type === "agent"
				? (node.outcomes ?? [])
				: [];
	return new Map(options.map((option) => [option.name, option.description]));
}

/** What ends a Wait node as done, by what it waits for. */
const WAIT_DONE: Record<WaitUntil["kind"], string> = {
	duration: "The time is up",
	time: "The time came",
	command: "The command passed",
	signal: "The signal came",
};

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

/**
 * The count of a node's errors, or of its warnings when it has none. Its
 * tooltip lists every issue of the node, errors first.
 */
function IssueBadge({
	errors,
	warnings,
}: {
	errors: readonly FlowIssue[];
	warnings: readonly FlowIssue[];
}) {
	const isError = errors.length > 0;
	const count = isError ? errors.length : warnings.length;
	const Icon = isError ? CircleAlertIcon : TriangleAlertIcon;
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Badge
						variant={isError ? "destructive" : "outline"}
						className={cn(
							"h-4 gap-0.5 px-1.5 text-[10px] tabular-nums",
							!isError &&
								"border-status-waiting bg-status-waiting text-background",
						)}
					/>
				}
			>
				<Icon aria-hidden="true" />
				<span className="sr-only">{isError ? "Errors:" : "Warnings:"}</span>
				{count}
			</TooltipTrigger>
			<TooltipContent side="top" className="max-w-72">
				<ul className="flex flex-col gap-1">
					{[...errors, ...warnings].map((issue, index) => {
						const IssueIcon =
							issue.severity === "error" ? CircleAlertIcon : TriangleAlertIcon;
						return (
							<li
								// The same message can come twice.
								key={`${issue.severity}:${issue.message}:${index}`}
								className="flex items-start gap-1.5"
							>
								<IssueIcon
									className={cn(
										"mt-0.5 size-3 shrink-0",
										issue.severity === "error"
											? "text-destructive"
											: "text-status-waiting",
									)}
									aria-hidden="true"
								/>
								<span>{issue.message}</span>
							</li>
						);
					})}
				</ul>
			</TooltipContent>
		</Tooltip>
	);
}

const FlowNodeCard = memo(function FlowNodeCard({
	id,
	data,
	selected,
	isConnectable,
}: NodeProps<FlowCanvasNode>) {
	const { node, isStart, issues, run } = data;
	const errors = issues.filter((issue) => issue.severity === "error");
	const warnings = issues.filter((issue) => issue.severity === "warning");
	const errorCount = errors.length;
	const warningCount = warnings.length;
	const meta = NODE_TYPE[node.type];
	const Icon =
		node.type === "decision"
			? DECIDED_BY_ICON[node.by]
			: node.type === "value"
				? VALUE_BY_ICON[node.by]
				: runsEach(node)
					? CALL_EACH_ICON
					: meta.icon;
	const stateColor = run ? outcomeColor(node, run.state) : undefined;
	const runColor = run
		? stepStateStyle(run.state, stateColor).color
		: undefined;
	const active = run?.state === "running";
	const waiting = run?.state === "waiting";
	// The variables the node sets when its step ends, each once.
	const writes = [...new Set((node.set ?? []).map((write) => write.variable))];

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
				// A node with issues tints its card and gets a band on top, so it
				// stands out even zoomed out. Warnings are dashed amber.
				errorCount > 0 &&
					"border-destructive bg-[color-mix(in_oklch,var(--destructive)_6%,var(--card))]",
				errorCount === 0 &&
					warningCount > 0 &&
					"border-status-waiting border-dashed bg-[color-mix(in_oklch,var(--status-waiting)_7%,var(--card))]",
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
			{errorCount > 0 || warningCount > 0 ? (
				<span
					aria-hidden="true"
					className={cn(
						"pointer-events-none absolute -inset-x-px -top-px h-1 rounded-t-lg",
						errorCount > 0 ? "bg-destructive" : "bg-status-waiting",
					)}
				/>
			) : null}
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
							{writes.length > 0 ? (
								<Badge
									variant="outline"
									className="h-4 gap-0.5 px-1.5 font-mono text-[10px] text-foreground"
									title={`Sets ${writes.join(", ")} when the step ends`}
								>
									<VariableIcon aria-hidden="true" />
									sets {writes.length}
								</Badge>
							) : null}
							{errorCount > 0 || warningCount > 0 ? (
								<IssueBadge errors={errors} warnings={warnings} />
							) : null}
							{run ? (
								<OutcomeBadge
									state={run.state}
									color={stateColor}
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
					{node.type === "value" ? <ValueBody node={node} /> : null}
					{node.type === "wait" ? <WaitBody node={node} /> : null}
					{node.type === "tool" ? <ToolBody node={node} /> : null}
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
						const style = outcomeStyle(outcome, outcomeColor(node, outcome));
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

export const nodeTypes: NodeTypes = {
	agent: FlowNodeCard,
	command: FlowNodeCard,
	decision: FlowNodeCard,
	call: FlowNodeCard,
	value: FlowNodeCard,
	wait: FlowNodeCard,
	tool: FlowNodeCard,
} satisfies Record<FlowNodeType, unknown>;
