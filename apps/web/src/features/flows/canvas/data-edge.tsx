// A dotted line from a node to a node that reads it in a template or a
// rule (`useDataLinks`). It is no edge of the flow: you cannot select,
// focus or delete it, and it lies under the outcome edges. It leaves the
// bottom of the node it reads and enters the top of the reader, wherever
// the two are, as React Flow's floating edges do.

import { Badge } from "@nightshift/ui/components/badge";
import {
	BaseEdge,
	type Edge,
	EdgeLabelRenderer,
	type EdgeProps,
	getBezierPath,
	type InternalNode,
	Position,
	useInternalNode,
} from "@xyflow/react";
import { memo } from "react";

export type DataEdgeData = {
	/** What the reader reads of the node, each once: `data.tasks`. */
	refs: string[];
};

export type DataCanvasEdge = Edge<DataEdgeData, "data">;

/** Muted, so it never reads as an outcome or a status. */
const STROKE = "color-mix(in oklch, var(--muted-foreground) 70%, transparent)";

const ARROW_ID = "ns-data-arrow";

/** The arrowhead of every dotted line. Render once inside the canvas. */
export function DataMarker() {
	return (
		<svg className="absolute size-0" aria-hidden="true">
			<defs>
				<marker
					id={ARROW_ID}
					viewBox="0 0 10 10"
					refX="9"
					refY="5"
					markerWidth="7"
					markerHeight="7"
					markerUnits="userSpaceOnUse"
					orient="auto-start-reverse"
				>
					<path d="M0,0 L10,5 L0,10 z" style={{ fill: STROKE }} />
				</marker>
			</defs>
		</svg>
	);
}

/** The middle of a node's top or bottom side, on the canvas. */
function anchor(node: InternalNode, side: "top" | "bottom") {
	const { x, y } = node.internals.positionAbsolute;
	const width = node.measured.width ?? 0;
	const height = node.measured.height ?? 0;
	return { x: x + width / 2, y: side === "top" ? y : y + height };
}

/** `data.tasks`, or `data.tasks +2` when it reads more. */
function refsText(refs: readonly string[]): string {
	const [first] = refs;
	return refs.length > 1 ? `${first} +${refs.length - 1}` : (first ?? "");
}

export const DataEdge = memo(function DataEdge({
	id,
	source,
	target,
	data,
}: EdgeProps<DataCanvasEdge>) {
	const from = useInternalNode(source);
	const to = useInternalNode(target);
	if (!from || !to) return null;
	const start = anchor(from, "bottom");
	const end = anchor(to, "top");
	const [path, labelX, labelY] = getBezierPath({
		sourceX: start.x,
		sourceY: start.y,
		sourcePosition: Position.Bottom,
		targetX: end.x,
		targetY: end.y,
		targetPosition: Position.Top,
	});
	const refs = data?.refs ?? [];
	return (
		<>
			<BaseEdge
				id={id}
				path={path}
				interactionWidth={0}
				markerEnd={`url(#${ARROW_ID})`}
				style={{
					stroke: STROKE,
					strokeWidth: 1.5,
					strokeDasharray: "1 5",
					strokeLinecap: "round",
				}}
			/>
			{refs.length > 0 ? (
				<EdgeLabelRenderer>
					<Badge
						variant="outline"
						title={refs.join(", ")}
						className="nodrag nopan pointer-events-auto absolute h-5 border-dashed bg-card font-mono font-normal text-[11px] text-muted-foreground shadow-xs"
						style={{
							transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
						}}
					>
						{refsText(refs)}
					</Badge>
				</EdgeLabelRenderer>
			) : null}
		</>
	);
});
