// Draw an edge along the route that "Lay out" found: a line of horizontal and
// vertical segments from handle to handle, around the nodes in its way.
// Routes live in memory and in the browser, never in the flow file.

export type Point = { x: number; y: number };

export type EdgeRoute = {
	/** From the source handle to the target handle, bends in between. */
	points: Point[];
	/** The middle of the label, when the layout made room for one. */
	label?: Point;
};

/**
 * The route, moved onto the handles where React Flow draws them. The layout
 * snaps nodes to the grid after it routes, so the ends can be a few pixels
 * off. The bend next to each end moves with it, so every segment stays
 * horizontal or vertical.
 */
export function fitRoute(
	points: readonly Point[],
	source: Point,
	target: Point,
): Point[] {
	if (points.length < 3) {
		// Straight: one jog halfway when the ends no longer line up.
		if (source.y === target.y || source.x === target.x) return [source, target];
		const x = (source.x + target.x) / 2;
		return [source, { x, y: source.y }, { x, y: target.y }, target];
	}
	const fitted = points.map((point) => ({ ...point }));
	const last = fitted.length - 1;
	const first = points[0] as Point;
	const end = points[last] as Point;
	const afterFirst = fitted[1] as Point;
	const beforeEnd = fitted[last - 1] as Point;
	if (afterFirst.y === first.y) afterFirst.y = source.y;
	else afterFirst.x = source.x;
	if (beforeEnd.y === end.y) beforeEnd.y = target.y;
	else beforeEnd.x = target.x;
	fitted[0] = source;
	fitted[last] = target;
	return fitted;
}

/** An SVG path along the points, its corners rounded. */
export function roundedPath(points: readonly Point[], radius = 10): string {
	const [start, ...rest] = points;
	if (!start) return "";
	let path = `M${start.x},${start.y}`;
	for (const [index, corner] of rest.entries()) {
		const before = points[index] as Point;
		const after = rest[index + 1];
		if (!after) {
			path += ` L${corner.x},${corner.y}`;
			break;
		}
		// No bigger than half of either segment, or two corners overlap.
		const r = Math.min(
			radius,
			distance(before, corner) / 2,
			distance(corner, after) / 2,
		);
		const into = towards(corner, before, r);
		const out = towards(corner, after, r);
		path += ` L${into.x},${into.y} Q${corner.x},${corner.y} ${out.x},${out.y}`;
	}
	return path;
}

function distance(a: Point, b: Point): number {
	return Math.hypot(b.x - a.x, b.y - a.y);
}

/** The point `length` along the line from `from` towards `to`. */
function towards(from: Point, to: Point, length: number): Point {
	const total = distance(from, to);
	if (total === 0) return from;
	const t = length / total;
	return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

/** The point halfway along the line, by length. */
export function halfway(points: readonly Point[]): Point {
	const lengths = points.slice(1).map((point, i) => {
		return distance(points[i] as Point, point);
	});
	let rest = lengths.reduce((sum, length) => sum + length, 0) / 2;
	for (const [i, length] of lengths.entries()) {
		if (rest <= length)
			return towards(points[i] as Point, points[i + 1] as Point, rest);
		rest -= length;
	}
	return points[points.length - 1] ?? { x: 0, y: 0 };
}

/** How far the other outcomes of an edge run before they join its line. */
const JOIN = 24;

/**
 * The short line from another outcome's handle to the edge's route, for an
 * edge that carries several outcomes. It runs out of its handle, then up or
 * down to the route's first segment, so the outcomes join near the node.
 */
export function stemPoints(start: Point, route: readonly Point[]): Point[] {
	const first = route[0];
	const next = route[1];
	if (!first || !next) return [start];
	const x =
		next.y === first.y && next.x > first.x
			? Math.min(next.x, first.x + JOIN)
			: first.x + JOIN;
	return [start, { x, y: start.y }, { x, y: first.y }];
}
