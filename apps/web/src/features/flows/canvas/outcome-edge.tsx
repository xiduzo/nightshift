import { type Flow, type OutcomeColor, outcomeColors } from "@nightshift/flows";
import { Badge } from "@nightshift/ui/components/badge";
import { cn } from "@nightshift/ui/lib/utils";
import {
	BaseEdge,
	type Edge,
	EdgeLabelRenderer,
	type EdgeProps,
	type EdgeTypes,
	getSmoothStepPath,
	type Position,
	type ReactFlowState,
	useStore,
} from "@xyflow/react";
import {
	createContext,
	Fragment,
	memo,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";

import {
	type EdgeGroup,
	type EdgeSegment,
	groupSegments,
	labelAtRest,
	SEGMENT_SEPARATOR,
	segmentText,
} from "./edge-groups";
import {
	type EdgeRoute,
	fitRoute,
	halfway,
	type Point,
	roundedPath,
	stemPoints,
} from "./edge-route";
import {
	OUTCOME_COLOR_STYLE,
	outcomeStyle,
	resolveOutcomeColor,
} from "./outcome-badge";
import { type RouteBook, routeOf } from "./route-cache";

export type OutcomeEdgeData = {
	/** One per edge of the flow this drawn edge carries, in handle order. */
	segments: EdgeSegment[];
	/** The segment that is selected, when the drawn edge is. */
	selectedSegment?: string;
	/** The route the last "Lay out" found, while its nodes stay put. */
	route?: EdgeRoute;
};

export type FlowCanvasEdge = Edge<OutcomeEdgeData, "outcome">;

/**
 * The drawn edges of a flow: one per node pair (`groups`), with its route
 * when the book has one that still holds.
 */
export function canvasEdges(
	flow: Pick<Flow, "nodes">,
	groups: readonly EdgeGroup[],
	{
		routes = {},
		errors,
		traversals,
		selected,
		boxes,
	}: {
		routes?: RouteBook;
		/** Ids of edges with an error. */
		errors?: ReadonlySet<string>;
		/** Run view only: how often the run took each edge, by edge id. */
		traversals?: Readonly<Record<string, number>>;
		/** The id of the selected edge of the flow. */
		selected?: string;
		/** Where each folded Section's box is, by its canvas id. */
		boxes?: ReadonlyMap<string, Point>;
	} = {},
): FlowCanvasEdge[] {
	const at = new Map<string, Point>(
		flow.nodes.map((node) => [node.id, node.position]),
	);
	for (const [id, position] of boxes ?? []) at.set(id, position);
	return groups.map((group) => {
		const segments = groupSegments(flow, group).map((segment) => ({
			...segment,
			hasError: errors?.has(segment.id) ?? false,
			traversals: traversals ? (traversals[segment.id] ?? 0) : undefined,
		}));
		const selectedSegment = segments.find(
			(segment) => segment.id === selected,
		)?.id;
		return {
			id: group.id,
			type: "outcome",
			source: group.from,
			sourceHandle: segments[0] && handleOf(segments[0]),
			target: group.to,
			selected: selectedSegment !== undefined,
			data: { segments, selectedSegment, route: routeOf(routes, group, at) },
		};
	});
}

/** The handle an edge leaves from: its outcome's, or a folded Section's exit. */
function handleOf(segment: EdgeSegment): string {
	return segment.handle ?? segment.outcome;
}

/** Lets an edge label select one edge of the flow. Absent in read-only canvases. */
export const SelectEdgeContext = createContext<((id: string) => void) | null>(
	null,
);

/** An edge whose outcomes have different colours draws in this one. */
const MIXED_COLOR = "var(--muted-foreground)";

const markerId = (color: OutcomeColor | "mixed") => `ns-arrow-${color}`;

/** Arrowheads, one per outcome colour. Render once inside each canvas. */
export function OutcomeMarkers() {
	return (
		<svg className="absolute size-0" aria-hidden="true">
			<defs>
				{[...outcomeColors, "mixed" as const].map((color) => (
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
							style={{
								fill:
									color === "mixed"
										? MIXED_COLOR
										: OUTCOME_COLOR_STYLE[color].color,
							}}
						/>
					</marker>
				))}
			</defs>
		</svg>
	);
}

/** How far an edge runs out of its handle before it turns. */
const STEP_OFFSET = 28;

const NO_STEMS: (Point | null)[] = [];

/**
 * Where the handles of an edge's other outcomes are: a drawn edge that
 * carries several outcomes starts at the first handle and joins the others.
 */
function useStemStarts(source: string, handles: string[]): (Point | null)[] {
	const key = handles.join("\u0000");
	return useStore(
		useCallback(
			(state: ReactFlowState) => {
				const rest = key.split("\u0000").slice(1);
				if (rest.length === 0) return NO_STEMS;
				const node = state.nodeLookup.get(source);
				const bounds = node?.internals.handleBounds?.source;
				if (!node || !bounds) return NO_STEMS;
				const { x, y } = node.internals.positionAbsolute;
				return rest.map((id) => {
					const handle = bounds.find((bound) => bound.id === id);
					// As React Flow ends an edge on a handle on the right.
					return handle
						? {
								x: x + handle.x + handle.width,
								y: y + handle.y + handle.height / 2,
							}
						: null;
				});
			},
			[source, key],
		),
		samePoints,
	);
}

function samePoints(a: (Point | null)[], b: (Point | null)[]): boolean {
	return (
		a.length === b.length &&
		a.every((point, i) => {
			const other = b[i];
			return (
				point === other || (point?.x === other?.x && point?.y === other?.y)
			);
		})
	);
}

/** Hovered, with a short grace so the pointer can move onto the label. */
function useHover() {
	const [hovered, setHovered] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
	const enter = useCallback(() => {
		clearTimeout(timer.current);
		setHovered(true);
	}, []);
	const leave = useCallback(() => {
		clearTimeout(timer.current);
		timer.current = setTimeout(() => setHovered(false), 150);
	}, []);
	useEffect(() => () => clearTimeout(timer.current), []);
	return { hovered, enter, leave };
}

type Paths = { main: string; label: Point; stems: (string | null)[] };

function routedPaths(
	route: EdgeRoute,
	source: Point,
	target: Point,
	stems: (Point | null)[],
): Paths {
	const points = fitRoute(route.points, source, target);
	return {
		main: roundedPath(points),
		label: route.label ?? halfway(points),
		stems: stems.map((start) =>
			start ? roundedPath(stemPoints(start, points)) : null,
		),
	};
}

function stepPaths(
	source: Point,
	target: Point,
	sourcePosition: Position,
	targetPosition: Position,
	stems: (Point | null)[],
): Paths {
	// Every outcome turns at the same x, so they share one vertical run.
	const centerX = (source.x + target.x) / 2;
	const step = (from: Point) =>
		getSmoothStepPath({
			sourceX: from.x,
			sourceY: from.y,
			targetX: target.x,
			targetY: target.y,
			sourcePosition,
			targetPosition,
			borderRadius: 10,
			offset: STEP_OFFSET,
			centerX,
		});
	const [main, labelX, labelY] = step(source);
	return {
		main,
		label: { x: labelX, y: labelY },
		stems: stems.map((start) => (start ? step(start)[0] : null)),
	};
}

const OutcomeEdge = memo(function OutcomeEdge({
	id,
	source,
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
	const segments = data?.segments ?? [];
	const stemStarts = useStemStarts(source, segments.map(handleOf));
	const hover = useHover();
	const first = segments[0];
	if (!data || !first) return null;

	const from = { x: sourceX, y: sourceY };
	const to = { x: targetX, y: targetY };
	const paths = data.route
		? routedPaths(data.route, from, to, stemStarts)
		: stepPaths(from, to, sourcePosition, targetPosition, stemStarts);

	const colors = new Set(
		segments.map((segment) =>
			resolveOutcomeColor(segment.outcome, segment.color),
		),
	);
	const single = colors.size === 1 ? [...colors][0] : undefined;
	const color = single ? OUTCOME_COLOR_STYLE[single].color : MIXED_COLOR;
	const untaken = (segment: EdgeSegment) => segment.traversals === 0;
	const hasError = segments.some((segment) => segment.hasError);
	const merged = segments.length > 1;
	const showLabel = labelAtRest(segments) || hover.hovered || Boolean(selected);
	const stroke = (dimmed: boolean) => ({
		stroke: color,
		strokeWidth: selected ? 2.5 : 1.5,
		strokeDasharray: hasError ? "5 4" : undefined,
		opacity: dimmed ? 0.35 : 1,
	});

	return (
		<>
			<g onPointerEnter={hover.enter} onPointerLeave={hover.leave}>
				<BaseEdge
					id={id}
					path={paths.main}
					markerEnd={`url(#${markerId(single ?? "mixed")})`}
					style={stroke(segments.every(untaken))}
				/>
				{paths.stems.map((path, index) => {
					const segment = segments[index + 1];
					return path && segment ? (
						<BaseEdge
							key={segment.id}
							path={path}
							interactionWidth={12}
							style={stroke(untaken(segment))}
						/>
					) : null;
				})}
			</g>
			{showLabel ? (
				<EdgeLabelRenderer>
					<Badge
						variant="outline"
						render={
							merged ? (
								<span />
							) : (
								<button
									type="button"
									tabIndex={selectEdge ? 0 : -1}
									disabled={!selectEdge}
									onClick={() => selectEdge?.(first.id)}
								/>
							)
						}
						onPointerEnter={hover.enter}
						onPointerLeave={hover.leave}
						className={cn(
							"nodrag nopan pointer-events-auto absolute h-5 bg-card font-mono text-[11px] shadow-xs disabled:cursor-default",
							!merged && outcomeStyle(first.outcome, first.color).text,
							selected && "ring-2 ring-ring",
							hasError && "border-destructive border-dashed",
							segments.every(untaken) && "opacity-60",
							!merged && selectEdge && "cursor-pointer hover:bg-muted",
						)}
						style={{
							transform: `translate(-50%, -50%) translate(${paths.label.x}px, ${paths.label.y}px)`,
							borderColor: hasError
								? undefined
								: `color-mix(in oklch, ${color} 55%, transparent)`,
						}}
					>
						{merged
							? segments.map((segment, index) => (
									<Fragment key={segment.id}>
										{index > 0 ? (
											<span
												aria-hidden="true"
												className="text-muted-foreground"
											>
												{SEGMENT_SEPARATOR.trim()}
											</span>
										) : null}
										<button
											type="button"
											tabIndex={selectEdge ? 0 : -1}
											disabled={!selectEdge}
											onClick={() => selectEdge?.(segment.id)}
											className={cn(
												outcomeStyle(segment.outcome, segment.color).text,
												"rounded-sm disabled:cursor-default",
												untaken(segment) && "opacity-60",
												selectEdge && "cursor-pointer hover:underline",
												data.selectedSegment === segment.id &&
													"underline underline-offset-2",
											)}
										>
											{segmentText(segment)}
										</button>
									</Fragment>
								))
							: segmentText(first)}
					</Badge>
				</EdgeLabelRenderer>
			) : null}
		</>
	);
});

export const edgeTypes: EdgeTypes = { outcome: OutcomeEdge };
