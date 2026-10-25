// A Section on the canvas: a frame drawn behind its nodes, or, folded, one
// box that stands for them. Both are React Flow nodes. The frame is not a
// React Flow parent (`parentId`): its nodes keep their own positions, and
// the frame is sized to them (`section-geometry.ts`).

import type {
	FlowIssue,
	FlowSection,
	OutcomeColor,
	SectionColor,
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
} from "@xyflow/react";
import {
	ChevronsDownUpIcon,
	ChevronsUpDownIcon,
	GroupIcon,
	PlayIcon,
} from "lucide-react";
import { createContext, memo, useContext } from "react";
import { exitHandleId } from "../edge-groups";
import {
	type FlowCanvasNode,
	IssueBadge,
	nodeTypes,
	useOverviewText,
} from "../flow-node";
import {
	OUTCOME_COLOR_STYLE,
	OutcomeBadge,
	outcomeLabel,
	outcomeStyle,
} from "../outcome-badge";
import type { SectionRunSummary } from "./section-run";

export type SectionFrameData = {
	section: FlowSection;
	/** How many of its nodes are on the canvas. */
	count: number;
	/** The Section's validation warnings. */
	issues: readonly FlowIssue[];
	/** The height of the header above the nodes. */
	header: number;
};

/** One handle of a folded box: the edges of one node and outcome that leave. */
export type SectionBoxExit = {
	from: string;
	outcome: string;
	color?: OutcomeColor;
};

export type SectionBoxData = {
	section: FlowSection;
	count: number;
	exits: SectionBoxExit[];
	/** The flow starts inside the Section. */
	isStart: boolean;
	issues: readonly FlowIssue[];
	/** Run view only: the state of the nodes it hides. */
	run?: SectionRunSummary;
};

export type SectionFrameNode = Node<SectionFrameData, "sectionFrame">;
export type SectionBoxNode = Node<SectionBoxData, "sectionBox">;
/** Every node a flow canvas draws. */
export type CanvasNode = FlowCanvasNode | SectionFrameNode | SectionBoxNode;

export type SectionActions = {
	setFolded: (sectionId: string, folded: boolean) => void;
	/** Selects a node that a folded box hides. Run view only. */
	selectNode?: (nodeId: string) => void;
};

/** What the frames and boxes can do. Without it they only show. */
export const SectionActionsContext = createContext<SectionActions | null>(null);

/** The Section's colour, from the theme. No colour: a neutral grey. */
function sectionColor(color: SectionColor | undefined): string {
	return color ? OUTCOME_COLOR_STYLE[color].color : "var(--muted-foreground)";
}

function mix(color: string, percent: number): string {
	return `color-mix(in oklch, ${color} ${percent}%, transparent)`;
}

/** The Section's label, else its id. */
function nameOf(section: FlowSection): string {
	return section.label.trim() || section.id;
}

function nodesText(count: number): string {
	return `${count} ${count === 1 ? "node" : "nodes"}`;
}

/**
 * The issue badge for a Section: its warnings (a Section has no errors:
 * the engine does not read it).
 */
function SectionIssues({ issues }: { issues: readonly FlowIssue[] }) {
	if (issues.length === 0) return null;
	return (
		<IssueBadge
			errors={issues.filter((issue) => issue.severity === "error")}
			warnings={issues.filter((issue) => issue.severity === "warning")}
		/>
	);
}

function FoldButton({
	section,
	folded,
	className,
}: {
	section: FlowSection;
	folded: boolean;
	className?: string;
}) {
	const actions = useContext(SectionActionsContext);
	if (!actions) return null;
	const label = folded ? "Unfold section" : "Fold section";
	const Icon = folded ? ChevronsUpDownIcon : ChevronsDownUpIcon;
	return (
		<Button
			variant="ghost"
			size="icon-xs"
			className={cn("nodrag nopan", className)}
			aria-label={label}
			title={label}
			onClick={(event) => {
				// Folding is not a click on the frame: it keeps the selection.
				event.stopPropagation();
				actions.setFolded(section.id, !folded);
			}}
		>
			<Icon />
		</Button>
	);
}

/**
 * The frame behind a Section's nodes: its name, node count, warnings and a
 * fold button. Only the header takes the pointer. The rest lets clicks
 * and drags through to the edges and the canvas.
 */
const SectionFrame = memo(function SectionFrame({
	data,
	selected,
}: NodeProps<SectionFrameNode>) {
	const { section, count, issues, header } = data;
	const color = sectionColor(section.color);
	const name = nameOf(section);
	const description = section.description?.trim();
	const overviewText = useOverviewText(64);
	const overview = overviewText > 0;
	return (
		<div
			className={cn(
				"relative size-full rounded-xl border-2 transition-shadow motion-reduce:transition-none",
				selected && "ring-2 ring-ring ring-offset-2 ring-offset-background",
			)}
			style={{ borderColor: mix(color, 45), background: mix(color, 6) }}
		>
			<div
				className={cn(
					"pointer-events-auto flex cursor-grab items-start gap-2 rounded-t-[10px] px-3 pt-2 active:cursor-grabbing",
					overview && "invisible",
				)}
				style={{ height: header }}
			>
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<div className="flex h-6 min-w-0 items-center gap-1.5">
						<span
							className="truncate font-medium text-sm"
							style={{ color: section.color ? color : undefined }}
							title={name}
						>
							{name}
						</span>
						<Badge
							variant="outline"
							className="h-4 shrink-0 bg-background/60 px-1.5 text-[10px] text-muted-foreground tabular-nums"
						>
							{nodesText(count)}
						</Badge>
						<SectionIssues issues={issues} />
					</div>
					{description ? (
						<p
							className="truncate text-muted-foreground text-xs"
							title={description}
						>
							{description}
						</p>
					) : null}
				</div>
				<FoldButton section={section} folded={false} className="-mr-1.5" />
			</div>
			{overview ? (
				// Zoomed out, the name stands above the frame in large type.
				<span
					className="pointer-events-none absolute bottom-full left-1 mb-[0.2em] whitespace-nowrap font-medium leading-none"
					style={{
						fontSize: overviewText,
						color: section.color ? color : undefined,
					}}
				>
					{name}
				</span>
			) : null}
		</div>
	);
});

/** What the nodes inside a folded box do in the run: who runs now, what failed. */
function BoxRun({ run, count }: { run: SectionRunSummary; count: number }) {
	const actions = useContext(SectionActionsContext);
	const now = run.now;
	return (
		<div className="flex min-w-0 flex-col gap-1 border-t px-3 py-2 text-[11px]">
			{now ? (
				<button
					type="button"
					disabled={!actions?.selectNode}
					onClick={(event) => {
						event.stopPropagation();
						actions?.selectNode?.(now.nodeId);
					}}
					className="nodrag nopan flex min-w-0 items-center gap-1.5 rounded-sm text-left hover:underline disabled:hover:no-underline"
					title={`Show ${now.nodeId}`}
				>
					<OutcomeBadge
						state={now.state}
						className="h-4 shrink-0 px-1.5 text-[10px]"
					/>
					<span className="truncate font-mono">{now.nodeId}</span>
				</button>
			) : null}
			{run.failed.length > 0 ? (
				<span className="truncate text-status-failed">
					Failed: <span className="font-mono">{run.failed.join(", ")}</span>
				</span>
			) : null}
			<span className="text-muted-foreground tabular-nums">
				{run.reached === 0
					? "The run has not come here yet."
					: `The run reached ${run.reached} of ${nodesText(count)}.`}
			</span>
		</div>
	);
}

/**
 * A folded Section: one box in place of its nodes. One input handle, and
 * one output handle for each node and outcome whose edges leave it,
 * labelled "verdict · pass".
 */
const SectionBox = memo(function SectionBox({
	data,
	selected,
	isConnectable,
}: NodeProps<SectionBoxNode>) {
	const { section, count, exits, isStart, issues, run } = data;
	const color = sectionColor(section.color);
	const name = nameOf(section);
	const description = section.description?.trim();
	const overviewText = useOverviewText();
	const overview = overviewText > 0;
	const active = (run?.running.length ?? 0) > 0;
	const waiting = (run?.waiting.length ?? 0) > 0;
	return (
		<div
			className={cn(
				"relative w-64 rounded-lg border-2 bg-card text-card-foreground text-xs shadow-sm transition-[box-shadow,opacity] motion-reduce:transition-none",
				selected && "ring-2 ring-ring",
				active &&
					"shadow-[0_0_0_1px_var(--status-running),0_0_18px_0_color-mix(in_oklch,var(--status-running)_35%,transparent)]",
				waiting &&
					"shadow-[0_0_0_1px_var(--status-waiting),0_0_20px_2px_color-mix(in_oklch,var(--status-waiting)_40%,transparent)]",
				run?.reached === 0 && "opacity-55",
			)}
			style={{ borderColor: mix(color, 60) }}
		>
			<Handle
				type="target"
				position={Position.Left}
				isConnectable={isConnectable}
				className="size-2.5! min-h-0! min-w-0! border-2! border-card! bg-muted-foreground!"
				style={{ top: 20 }}
				title="Drag an edge here to lead into the Section"
			/>
			<div className={cn(overview && "invisible")}>
				<div
					className="flex min-w-0 flex-col gap-0.5 rounded-t-md px-3 pt-2.5 pb-2"
					style={{ background: mix(color, 8) }}
				>
					<div className="flex h-5 min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground uppercase tracking-wider">
						<GroupIcon className="size-3.5 shrink-0" aria-hidden="true" />
						<span className="truncate">Section</span>
						{isStart ? (
							<Badge
								variant="outline"
								className="h-4 gap-0.5 px-1.5 font-mono text-[10px] text-foreground lowercase tracking-normal"
								title="The run starts in this Section"
							>
								<PlayIcon aria-hidden="true" />
								start
							</Badge>
						) : null}
						<span className="ml-auto flex shrink-0 items-center gap-1 normal-case tracking-normal">
							<SectionIssues issues={issues} />
							<FoldButton section={section} folded className="-my-1 -mr-1.5" />
						</span>
					</div>
					<span
						className="truncate font-medium text-sm leading-6"
						style={{ color: section.color ? color : undefined }}
						title={name}
					>
						{name}
					</span>
					<span className="truncate text-muted-foreground" title={description}>
						{description
							? `${nodesText(count)} · ${description}`
							: nodesText(count)}
					</span>
				</div>
				{run ? <BoxRun run={run} count={count} /> : null}
				{exits.length > 0 ? (
					<ul className="flex flex-col border-t py-1" aria-label="Ways out">
						{exits.map((exit) => {
							const style = outcomeStyle(exit.outcome, exit.color);
							return (
								<li
									key={exitHandleId(exit.from, exit.outcome)}
									className="relative flex h-5 min-w-0 items-center justify-end gap-1 pr-3.5 pl-3 text-[11px]"
								>
									<span className="truncate font-mono text-muted-foreground">
										{exit.from}
									</span>
									<span aria-hidden="true" className="text-muted-foreground">
										·
									</span>
									<span
										className={cn("shrink-0 font-medium font-mono", style.text)}
									>
										{outcomeLabel(exit.outcome)}
									</span>
									<Handle
										type="source"
										id={exitHandleId(exit.from, exit.outcome)}
										position={Position.Right}
										isConnectable={false}
										className="size-2.5! min-h-0! min-w-0! border-2! border-card!"
										style={{ background: style.color }}
									/>
								</li>
							);
						})}
					</ul>
				) : null}
			</div>
			{overview ? (
				<div
					className="absolute inset-0 flex flex-col items-center justify-center gap-[0.3em] overflow-hidden p-3 text-center"
					style={{ fontSize: overviewText }}
				>
					<GroupIcon
						className="size-[0.9em] shrink-0 text-muted-foreground"
						aria-hidden="true"
					/>
					<span
						className="line-clamp-3 break-all font-medium leading-tight"
						style={{ color: section.color ? color : undefined }}
					>
						{name}
					</span>
				</div>
			) : null}
		</div>
	);
});

/** The node types of every flow canvas: the flow's nodes, and Sections. */
export const canvasNodeTypes: NodeTypes = {
	...nodeTypes,
	sectionFrame: SectionFrame,
	sectionBox: SectionBox,
};
