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
import { CalledFlowName } from "./called-flow-name";
import {
	CALL_EACH_ICON,
	DECIDED_BY_ICON,
	NODE_TYPE,
	VALUE_BY_ICON,
} from "./node-type";
import {
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
	/** A proposed change on view: how the node differs from the draft. */
	change?: DiffMark;
};

/** How a node or edge of a proposed flow differs from the editor's draft. */
export type DiffMark = "added" | "removed" | "changed";

const DIFF_WORD: Record<DiffMark, string> = {
	added: "New",
	removed: "Removed",
	changed: "Changed",
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
 * The font size, in canvas pixels, that reads as `OVERVIEW_TEXT` on screen
 * when zoomed out to the overview (at most `max`). Zero when zoomed in.
 */
export function useOverviewText(max = OVERVIEW_TEXT_MAX): number {
	const overview = useStore(overviewZoom);
	return overview ? Math.min(OVERVIEW_TEXT / overview, max) : 0;
}

/**
 * The count of a node's errors, or of its warnings when it has none. Its
 * tooltip lists every issue of the node, errors first.
 */
export function IssueBadge({
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

/** Where the input handle sits, from the top: level with the icon tile.
 *  `flow-layout.ts` routes edges to the same spot. */
const INPUT_Y = 26;
/** The id's largest size in the overview: two lines and the icon fit in a
 *  card with one outcome. */
const CARD_OVERVIEW_TEXT_MAX = 24;

/**
 * A node on the canvas: a compact chip with the node's icon, id and one line
 * under it, then one row per outcome with its handle. The icon tile carries
 * the state: a run's step state on its corner, and the tile tinted by that
 * state or by the node's issues. In a run, the outcome the step ended on
 * lights up on its own row. The rest of the node shows in the inspector.
 */
const FlowNodeCard = memo(function FlowNodeCard({
	id,
	data,
	selected,
	isConnectable,
}: NodeProps<FlowCanvasNode>) {
	const { node, isStart, issues, run, change } = data;
	const errors = issues.filter((issue) => issue.severity === "error");
	const warnings = issues.filter((issue) => issue.severity === "warning");
	const meta = NODE_TYPE[node.type];
	const Icon =
		node.type === "decision"
			? DECIDED_BY_ICON[node.by]
			: node.type === "value"
				? VALUE_BY_ICON[node.by]
				: runsEach(node)
					? CALL_EACH_ICON
					: meta.icon;
	const state = run
		? stepStateStyle(run.state, outcomeColor(node, run.state))
		: undefined;
	const StateIcon = state?.icon;
	const running = run?.state === "running";
	const waiting = run?.state === "waiting";
	// The tile takes the run state's colour, else the colour of the worst issue.
	const tileColor =
		state?.color ??
		(errors.length > 0
			? "var(--destructive)"
			: warnings.length > 0
				? "var(--status-waiting)"
				: undefined);
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
	const overviewText = useOverviewText(CARD_OVERVIEW_TEXT_MAX);
	const overview = overviewText > 0;

	return (
		<div
			className={cn(
				"relative w-56 rounded-xl border bg-card text-card-foreground text-xs shadow-xs transition-[box-shadow,opacity,border-color] motion-reduce:transition-none",
				selected && "border-ring ring-3 ring-ring/30",
				// Not reached, or removed: the card stays opaque, so edges and
				// nodes behind it do not show through. Only its content fades.
				(run === null || change === "removed") && "border-dashed shadow-none",
				change === "added" &&
					"border-status-finished ring-3 ring-status-finished/25",
			)}
		>
			{change === "changed" ? (
				<span
					title={DIFF_WORD.changed}
					className="absolute -top-1 -right-1 z-10 size-2.5 rounded-full bg-status-waiting ring-2 ring-card"
				>
					<span className="sr-only">{DIFF_WORD.changed}</span>
				</span>
			) : change ? (
				<span className="sr-only">{DIFF_WORD[change]}</span>
			) : null}
			<Handle
				type="target"
				position={Position.Left}
				isConnectable={isConnectable}
				className="size-2.5! min-h-0! min-w-0! border-2! border-card! bg-muted-foreground!"
				style={{ top: INPUT_Y }}
			/>
			{/* Kept in the overview, only hidden: the node keeps its size, so
			    the layout and the edges stay where they are. */}
			<div
				className={cn(
					overview && "invisible",
					(run === null || change === "removed") && "opacity-60",
				)}
			>
				<div className="flex min-w-0 items-center gap-2.5 p-2.5">
					<div
						className="relative grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"
						style={
							tileColor
								? {
										background: `color-mix(in oklch, ${tileColor} 18%, var(--card))`,
										color: tileColor,
									}
								: undefined
						}
						title={meta.label}
					>
						{/* A running step turns its state's icon, so it reads as busy. */}
						{running && StateIcon ? (
							<StateIcon
								className="size-4 animate-spin motion-reduce:animate-none"
								aria-hidden="true"
							/>
						) : (
							<Icon className="size-4" aria-hidden="true" />
						)}
						{waiting ? (
							<span
								className="absolute inset-0 rounded-lg ring-2 ring-status-waiting motion-safe:animate-ping"
								aria-hidden="true"
							/>
						) : null}
					</div>
					<div className="flex min-w-0 flex-1 flex-col">
						<span
							className="truncate font-medium font-mono text-[13px] leading-5"
							title={node.id}
						>
							{node.id}
						</span>
						<span
							className="truncate text-[11px] text-muted-foreground"
							style={state ? { color: state.color } : undefined}
						>
							{state
								? state.label
								: label && label !== node.id
									? label
									: meta.label}
						</span>
					</div>
					<div className="flex shrink-0 flex-col items-end gap-1">
						{isStart ? (
							<Badge
								variant="outline"
								className="h-4 gap-0.5 px-1 text-[10px]"
								title="The run starts here"
							>
								<PlayIcon aria-hidden="true" />
								<span className="sr-only">Start</span>
							</Badge>
						) : null}
						{errors.length > 0 || warnings.length > 0 ? (
							<IssueBadge errors={errors} warnings={warnings} />
						) : null}
						{writes.length > 0 ? (
							<Badge
								variant="outline"
								className="h-4 gap-0.5 px-1 font-mono text-[10px]"
								title={`Sets ${writes.join(", ")} when the step ends`}
							>
								<VariableIcon aria-hidden="true" />
								{writes.length}
							</Badge>
						) : null}
						{run && run.visits > 1 ? (
							<span
								className="text-[10px] text-muted-foreground tabular-nums"
								title={`${run.visits} visits`}
							>
								×{run.visits}
							</span>
						) : null}
					</div>
				</div>

				{node.type === "call" ? (
					<div className="-mt-1 px-2.5 pb-2">
						<CalledFlowName
							nodeId={node.id}
							name={node.flow}
							prefix={runsEach(node) ? "Each runs" : "Runs"}
						/>
					</div>
				) : null}

				<ul
					className="flex flex-col border-t border-dashed py-1"
					aria-label={node.type === "decision" ? "Options" : "Outcomes"}
				>
					{outcomes.length === 0 ? (
						<li className="flex h-5 items-center justify-end pr-3.5 text-[11px] text-muted-foreground italic">
							No options yet
						</li>
					) : null}
					{outcomes.map((outcome) => {
						const style = outcomeStyle(outcome, outcomeColor(node, outcome));
						const taken = run?.state === outcome;
						return (
							<li
								key={outcome}
								className={cn(
									"relative flex h-5 items-center justify-end pr-3.5 text-[11px]",
									run && !taken && "opacity-35",
								)}
								title={descriptions.get(outcome)}
							>
								{taken ? (
									<span
										className="absolute inset-y-0 right-0 left-2 rounded-l-full"
										style={{
											background: `linear-gradient(to right, transparent, color-mix(in oklch, ${style.color} 22%, transparent))`,
										}}
										aria-hidden="true"
									/>
								) : null}
								<span
									className={cn(
										"relative font-mono",
										style.text,
										taken ? "font-semibold" : "font-medium",
									)}
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
					<span className="line-clamp-2 break-all font-medium font-mono leading-tight">
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
