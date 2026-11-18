import {
	CONVERT_FORMAT_LABEL,
	type FlowIssue,
	type FlowNode,
	type FlowNodeType,
	nodeOutcomes,
	outcomeColor,
	runsEach,
} from "@nightshift/flows";
import { Badge } from "@nightshift/ui/components/badge";
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
	ArrowRightLeftIcon,
	LockIcon,
	PinIcon,
	PlayIcon,
	ServerIcon,
	SkipForwardIcon,
	VariableIcon,
} from "lucide-react";
import { memo, useEffect, useRef } from "react";
import {
	outcomeLabel,
	outcomeStyle,
	type StepState,
	stepStateStyle,
} from "../outcomes";
import type { SampleLine } from "../viewer";
import { CalledFlowName } from "./called-flow-name";
import { EndRow, SubflowDevice } from "./card-rows";
import { IssueBadge } from "./issue-badge";
import {
	CALL_EACH_ICON,
	DECIDED_BY_ICON,
	FAMILY_TINT,
	nodeFamily,
	nodeMeta,
	VALUE_BY_ICON,
} from "./node-type";
import { optionDescriptions } from "./outcome-descriptions";
import { useOverviewText } from "./overview-text";
import { SampleStrip } from "./sample-strip";

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
	/**
	 * Editor only, once the flow has a run: what the node gave in its newest
	 * run, in one line at the bottom of the card. With a mark: the pinned
	 * output, or the outcome the skipped node takes.
	 */
	sample?: SampleLine;
	/** Editor only: the node gives a pinned output in a test run, or is skipped. */
	mark?: NodeMark;
};

/**
 * A test run's mark on a node: the outcome it takes lights up on its row.
 * A pinned output that has not loaded has no outcome yet.
 */
export type NodeMark =
	| { kind: "pinned"; outcome: string | null }
	| { kind: "skipped"; outcome: string };

/** How a node or edge of a proposed flow differs from the editor's draft. */
export type DiffMark = "added" | "removed" | "changed";

const DIFF_WORD: Record<DiffMark, string> = {
	added: "New",
	removed: "Removed",
	changed: "Changed",
};

export type FlowCanvasNode = Node<FlowNodeData, FlowNodeType>;

/** Where the input handle sits, from the top: level with the icon tile.
 *  `layout/layout-graph.ts` routes edges to the same spot. */
const INPUT_Y = 26;
/** The id's largest size in the overview: two lines and the icon fit in a
 *  card with one outcome. */
const CARD_OVERVIEW_TEXT_MAX = 24;

/**
 * A node on the canvas: a compact chip with the node's icon, id and one line
 * under it, then one row per outcome with its handle. The icon tile carries
 * the state: a run's step state on its corner, and the tile tinted by that
 * state or by the node's issues. Else, outside a run, the tile takes the tint
 * of the node's family. In a run, the outcome the step ended on
 * lights up on its own row. The rest of the node shows in the inspector.
 */
const FlowNodeCard = memo(function FlowNodeCard({
	id,
	data,
	selected,
	isConnectable,
}: NodeProps<FlowCanvasNode>) {
	const { node, isStart, issues, run, change, sample, mark } = data;
	const errors = issues.filter((issue) => issue.severity === "error");
	const warnings = issues.filter((issue) => issue.severity === "warning");
	// A Decision is named a Gate or a Branch by who decides it.
	const meta = nodeMeta(node);
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
	// The tile takes the run state's colour, else the colour of the worst
	// issue, else its family's tint. A run view shows no tint: there, a
	// colour is a state.
	const tileColor =
		state?.color ??
		(errors.length > 0
			? "var(--destructive)"
			: warnings.length > 0
				? "var(--status-waiting)"
				: run === undefined
					? FAMILY_TINT[nodeFamily(node)]
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
				"relative w-56 rounded-xl border bg-card text-xs text-card-foreground shadow-xs transition-[box-shadow,opacity,border-color] motion-reduce:transition-none",
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
					(run === null || change === "removed" || mark?.kind === "skipped") &&
						"opacity-60",
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
							className="truncate font-mono text-[13px] leading-5 font-medium"
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
						{mark ? <MarkBadge mark={mark} /> : null}
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
						{node.device !== undefined ? (
							<SubflowDevice device={node.device} />
						) : null}
					</div>
				) : null}

				{node.type === "lease" ? (
					<div className="-mt-1 flex min-w-0 items-center gap-1 px-2.5 pb-2 text-[11px] text-muted-foreground">
						<LockIcon className="size-3 shrink-0" aria-hidden="true" />
						<span className="truncate font-mono" title={node.name}>
							{node.name || "No name yet"}
						</span>
					</div>
				) : null}

				{node.type === "convert" ? (
					<div className="-mt-1 flex min-w-0 items-center gap-1 px-2.5 pb-2 text-[11px] text-muted-foreground">
						<ArrowRightLeftIcon
							className="size-3 shrink-0"
							aria-hidden="true"
						/>
						<span className="truncate">
							{CONVERT_FORMAT_LABEL[node.from]} to{" "}
							{CONVERT_FORMAT_LABEL[node.to]}
						</span>
					</div>
				) : null}

				{node.type === "service" ? (
					<div className="-mt-1 flex min-w-0 items-center gap-1 px-2.5 pb-2 text-[11px] text-muted-foreground">
						<ServerIcon className="size-3 shrink-0" aria-hidden="true" />
						<span className="truncate font-mono" title={node.start}>
							{node.start || "No start command yet"}
						</span>
					</div>
				) : null}

				{node.type === "web-request" ? (
					<div className="-mt-1 flex min-w-0 items-center gap-1 px-2.5 pb-2 text-[11px] text-muted-foreground">
						<span className="shrink-0 font-mono">{node.method}</span>
						<span
							className="truncate font-mono"
							title={node.urlSecret ?? node.url}
						>
							{node.urlSecret !== undefined
								? `The URL in ${node.urlSecret || "a secret"}`
								: node.url || "No URL yet"}
						</span>
					</div>
				) : null}

				{node.type === "end" ? (
					<EndRow
						status={node.status}
						message={node.message}
						reached={run ? run.state === node.status : undefined}
					/>
				) : (
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
							// A run lights up the outcome its step took. In the
							// editor, a mark lights up the one a test run takes.
							const taken = run
								? run.state === outcome
								: mark?.outcome === outcome;
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
				)}
				{sample ? <SampleStrip line={sample} /> : null}
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
					<span className="line-clamp-2 font-mono leading-tight font-medium break-all">
						{node.id}
					</span>
				</div>
			) : null}
		</div>
	);
});

/** "Pinned output" or "Skipped", in the badge column. */
function MarkBadge({ mark }: { mark: NodeMark }) {
	const words =
		mark.kind === "pinned"
			? "Pinned output"
			: `Skipped: takes ${outcomeLabel(mark.outcome)}`;
	const Icon = mark.kind === "pinned" ? PinIcon : SkipForwardIcon;
	return (
		<Badge
			variant="secondary"
			className="h-4 gap-0.5 px-1 text-[10px]"
			title={words}
		>
			<Icon aria-hidden="true" />
			<span className="sr-only">{words}</span>
		</Badge>
	);
}

export const nodeTypes: NodeTypes = {
	agent: FlowNodeCard,
	command: FlowNodeCard,
	decision: FlowNodeCard,
	call: FlowNodeCard,
	value: FlowNodeCard,
	wait: FlowNodeCard,
	tool: FlowNodeCard,
	end: FlowNodeCard,
	join: FlowNodeCard,
	lease: FlowNodeCard,
	service: FlowNodeCard,
	"since-last-run": FlowNodeCard,
	convert: FlowNodeCard,
	"web-request": FlowNodeCard,
} satisfies Record<FlowNodeType, unknown>;
