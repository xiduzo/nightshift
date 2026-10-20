import {
	type FlowEdge,
	type FlowNode,
	type Outcome,
	type OutcomeColor,
	outcomeColor,
	outcomeColors,
} from "@nightshift/flows";
import { Badge } from "@nightshift/ui/components/badge";
import { cn } from "@nightshift/ui/lib/utils";
import {
	BaseEdge,
	type Edge,
	EdgeLabelRenderer,
	type EdgeProps,
	type EdgeTypes,
	getSmoothStepPath,
	type ReactFlowState,
	useStore,
} from "@xyflow/react";
import { createContext, memo, useCallback, useContext } from "react";

import {
	OUTCOME_COLOR_STYLE,
	outcomeLabel,
	outcomeStyle,
	resolveOutcomeColor,
} from "./outcome-badge";

export type OutcomeEdgeData = {
	outcome: Outcome;
	/** The colour the source node gives the outcome, if any. */
	color?: OutcomeColor;
	max?: number;
	hasError: boolean;
	/** Run view only: how often the run took this edge. */
	traversals?: number;
};

export type FlowCanvasEdge = Edge<OutcomeEdgeData, "outcome">;

/** The colour the edge's source node gives its outcome, if any. */
export function edgeColor(
	nodes: readonly FlowNode[],
	edge: Pick<FlowEdge, "from" | "outcome">,
): OutcomeColor | undefined {
	const source = nodes.find((node) => node.id === edge.from);
	return source ? outcomeColor(source, edge.outcome) : undefined;
}

/** Lets an edge label select its edge. Absent in read-only canvases. */
export const SelectEdgeContext = createContext<((id: string) => void) | null>(
	null,
);

const markerId = (color: OutcomeColor) => `ns-arrow-${color}`;

/** Arrowheads, one per outcome colour. Render once inside each canvas. */
export function OutcomeMarkers() {
	return (
		<svg className="absolute size-0" aria-hidden="true">
			<defs>
				{outcomeColors.map((color) => (
					<marker
						key={color}
						id={markerId(color)}
						viewBox="0 0 10 10"
						refX="9"
						refY="5"
						markerWidth="10"
						markerHeight="10"
						markerUnits="userSpaceOnUse"
						orient="auto-start-reverse"
					>
						<path
							d="M0,0 L10,5 L0,10 z"
							style={{ fill: OUTCOME_COLOR_STYLE[color].color }}
						/>
					</marker>
				))}
			</defs>
		</svg>
	);
}

function edgeLabel(data: OutcomeEdgeData): string {
	const label = outcomeLabel(data.outcome);
	if (data.traversals === undefined) {
		return data.max ? `${label} ×${data.max}` : label;
	}
	if (data.traversals > 0) {
		return `${label} · taken ${data.traversals}${data.max ? `/${data.max}` : ""}`;
	}
	return data.max ? `${label} · max ${data.max}` : label;
}

/** Between the vertical runs of edges that share both ends. */
const LANE_GAP = 14;
/** Between the labels of edges that share both ends. */
const LABEL_GAP = 24;

/**
 * Where an edge sits among the edges with the same source and target: its
 * offset from the middle, in lanes. Two outcomes of one node that lead to the
 * same node would otherwise share one vertical run and stack their labels.
 */
function useLane(id: string, source: string, target: string): number {
	return useStore(
		useCallback(
			(state: ReactFlowState) => {
				let index = 0;
				let count = 0;
				for (const edge of state.edges) {
					if (edge.source !== source || edge.target !== target) continue;
					if (edge.id === id) index = count;
					count += 1;
				}
				return index - (count - 1) / 2;
			},
			[id, source, target],
		),
	);
}

/** How far an edge runs out of its handle before it turns. */
const STEP_OFFSET = 28;
/** Between an edge that runs between rows and the nodes above and below it. */
const ROW_CLEARANCE = 40;

/**
 * Where an edge that runs back and down crosses: the carry-over of a flow laid
 * out in rows, from the end of one row to the start of the next. Left alone,
 * the step path crosses halfway between its ends, through the nodes of both
 * rows. This puts the crossing above the target, clear of every node it would
 * pass. Undefined for every other edge, and when there is no clear way.
 */
function useCarryY(
	source: string,
	target: string,
	sourceX: number,
	targetX: number,
): number | undefined {
	return useStore(
		useCallback(
			(state: ReactFlowState) => {
				const from = state.nodeLookup.get(source);
				const to = state.nodeLookup.get(target);
				if (!from || !to || targetX >= sourceX) return undefined;
				const top = (node: typeof from) => node.internals.positionAbsolute.y;
				const bottom = (node: typeof from) =>
					top(node) + (node.measured.height ?? 0);
				if (top(to) <= bottom(from)) return undefined;

				const left = targetX - STEP_OFFSET;
				const right = sourceX + STEP_OFFSET;
				let y = top(to) - ROW_CLEARANCE;
				let blocked = true;
				while (blocked && y > bottom(from)) {
					blocked = false;
					for (const node of state.nodeLookup.values()) {
						const x = node.internals.positionAbsolute.x;
						if (x > right || x + (node.measured.width ?? 0) < left) continue;
						if (
							// Strictly below the clear line, or `y` would not move.
							y > top(node) - ROW_CLEARANCE &&
							y <= bottom(node) + ROW_CLEARANCE
						) {
							y = top(node) - ROW_CLEARANCE;
							blocked = true;
						}
					}
				}
				return blocked ? undefined : y;
			},
			[source, target, sourceX, targetX],
		),
	);
}

const OutcomeEdge = memo(function OutcomeEdge({
	id,
	source,
	target,
	sourceX,
	sourceY,
	targetX,
	targetY,
	sourcePosition,
	targetPosition,
	data,
	selected,
}: EdgeProps<FlowCanvasEdge>) {
	const selectEdge = useContext(SelectEdgeContext);
	const lane = useLane(id, source, target);
	const carryY = useCarryY(source, target, sourceX, targetX);
	const [path, labelX, labelY] = getSmoothStepPath({
		sourceX,
		sourceY,
		targetX,
		targetY,
		sourcePosition,
		targetPosition,
		borderRadius: 10,
		offset: STEP_OFFSET,
		centerX: (sourceX + targetX) / 2 + lane * LANE_GAP,
		centerY: carryY,
	});
	if (!data) return null;

	const style = outcomeStyle(data.outcome, data.color);
	const color = style.color;
	const untaken = data.traversals === 0;

	return (
		<>
			<BaseEdge
				id={id}
				path={path}
				markerEnd={`url(#${markerId(resolveOutcomeColor(data.outcome, data.color))})`}
				style={{
					stroke: color,
					strokeWidth: selected ? 2.5 : 1.5,
					strokeDasharray: data.hasError ? "5 4" : undefined,
					opacity: untaken ? 0.35 : 1,
				}}
			/>
			<EdgeLabelRenderer>
				<Badge
					variant="outline"
					render={
						<button
							type="button"
							tabIndex={selectEdge ? 0 : -1}
							disabled={!selectEdge}
							onClick={() => selectEdge?.(id)}
						/>
					}
					className={cn(
						"nodrag nopan pointer-events-auto absolute h-5 bg-card font-mono text-[11px] shadow-xs disabled:cursor-default",
						style.text,
						selected && "ring-2 ring-ring",
						data.hasError && "border-destructive border-dashed",
						untaken && "opacity-60",
						selectEdge && "cursor-pointer hover:bg-muted",
					)}
					style={{
						transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY + lane * LABEL_GAP}px)`,
						borderColor: data.hasError
							? undefined
							: `color-mix(in oklch, ${color} 55%, transparent)`,
					}}
				>
					{edgeLabel(data)}
				</Badge>
			</EdgeLabelRenderer>
		</>
	);
});

export const edgeTypes: EdgeTypes = { outcome: OutcomeEdge };
