import type { Outcome } from "@nightshift/flows";
import { cn } from "@nightshift/ui/lib/utils";
import {
	BaseEdge,
	type Edge,
	EdgeLabelRenderer,
	type EdgeProps,
	type EdgeTypes,
	getSmoothStepPath,
} from "@xyflow/react";
import { createContext, memo, useContext } from "react";

import {
	OUTCOME_TONES,
	type OutcomeTone,
	outcomeLabel,
	outcomeStyle,
	outcomeTone,
} from "@/components/outcome-badge";

export type OutcomeEdgeData = {
	outcome: Outcome;
	max?: number;
	hasError: boolean;
	/** Run view only: how often the run took this edge. */
	traversals?: number;
};

export type FlowCanvasEdge = Edge<OutcomeEdgeData, "outcome">;

/** Lets an edge label select its edge. Absent in read-only canvases. */
export const SelectEdgeContext = createContext<((id: string) => void) | null>(
	null,
);

const markerId = (tone: OutcomeTone) => `ns-arrow-${tone}`;

/** Arrowheads, one per outcome colour. Render once inside each canvas. */
export function OutcomeMarkers() {
	return (
		<svg className="absolute size-0" aria-hidden="true">
			<defs>
				{OUTCOME_TONES.map((tone) => (
					<marker
						key={tone}
						id={markerId(tone)}
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
							style={{ fill: outcomeStyle(tone).color }}
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

const OutcomeEdge = memo(function OutcomeEdge({
	id,
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
	const [path, labelX, labelY] = getSmoothStepPath({
		sourceX,
		sourceY,
		targetX,
		targetY,
		sourcePosition,
		targetPosition,
		borderRadius: 10,
		offset: 28,
	});
	if (!data) return null;

	const style = outcomeStyle(data.outcome);
	const color = style.color;
	const untaken = data.traversals === 0;

	return (
		<>
			<BaseEdge
				id={id}
				path={path}
				markerEnd={`url(#${markerId(outcomeTone(data.outcome))})`}
				style={{
					stroke: color,
					strokeWidth: selected ? 2.5 : 1.5,
					strokeDasharray: data.hasError ? "5 4" : undefined,
					opacity: untaken ? 0.35 : 1,
				}}
			/>
			<EdgeLabelRenderer>
				<button
					type="button"
					tabIndex={selectEdge ? 0 : -1}
					disabled={!selectEdge}
					onClick={() => selectEdge?.(id)}
					className={cn(
						"nodrag nopan pointer-events-auto absolute border bg-card px-1.5 py-0.5 font-medium text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default",
						style.text,
						selected && "ring-1 ring-ring",
						data.hasError && "border-destructive",
						untaken && "opacity-60",
					)}
					style={{
						transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
						borderColor: data.hasError ? undefined : color,
					}}
				>
					{edgeLabel(data)}
				</button>
			</EdgeLabelRenderer>
		</>
	);
});

export const edgeTypes: EdgeTypes = { outcome: OutcomeEdge };
