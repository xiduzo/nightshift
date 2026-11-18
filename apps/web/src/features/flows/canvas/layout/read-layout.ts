import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api.js";
import type { EdgeRoute, Point } from "../edges";
import { splitEdges } from "./elk-graph";
import type { Box, LayoutGraph } from "./layout-graph";

export type Laid = {
	/** By node id, and by `sectionNodeId` for frames and folded Sections. */
	boxes: Map<string, Box>;
	/** By edge id. */
	routes: Map<string, EdgeRoute>;
};

/** The points without repeats, and without the middle of three in line. */
function tidy(points: Point[]): Point[] {
	const out: Point[] = [];
	for (const point of points) {
		const last = out[out.length - 1];
		if (last && last.x === point.x && last.y === point.y) continue;
		const before = out[out.length - 2];
		if (
			before &&
			last &&
			((before.x === last.x && last.x === point.x) ||
				(before.y === last.y && last.y === point.y))
		) {
			out[out.length - 1] = point;
			continue;
		}
		out.push(point);
	}
	return out;
}

/**
 * ELK's answer as boxes and routes, moved so the top-left box is at 0, 0.
 * Loops come back the right way round, and the pieces of an edge that
 * crosses a frame join into one route. An edge whose route misses its
 * handles gets none.
 */
export function readLayout(result: ElkNode, graph: LayoutGraph): Laid {
	const { pieces, joins } = splitEdges(graph);
	const back = new Set(
		pieces.filter((piece) => piece.back).map((piece) => piece.id),
	);
	const boxes = new Map<string, Box>();
	const elkEdges: ElkExtendedEdge[] = [];
	const collect = (node: ElkNode) => {
		elkEdges.push(...((node.edges ?? []) as ElkExtendedEdge[]));
		for (const child of node.children ?? []) {
			boxes.set(child.id, {
				x: child.x ?? 0,
				y: child.y ?? 0,
				width: child.width ?? 0,
				height: child.height ?? 0,
			});
			collect(child);
		}
	};
	collect(result);
	const all = [...boxes.values()];
	const left = Math.min(...all.map((box) => box.x));
	const top = Math.min(...all.map((box) => box.y));
	const shift = (point: Point) => ({ x: point.x - left, y: point.y - top });
	for (const box of all) Object.assign(box, shift(box));

	const parts = new Map<string, EdgeRoute>();
	for (const edge of elkEdges) {
		const section = edge.sections?.[0];
		if (!section) continue;
		const label = edge.labels?.[0];
		const points = [
			section.startPoint,
			...(section.bendPoints ?? []),
			section.endPoint,
		].map(shift);
		if (back.has(edge.id)) points.reverse();
		parts.set(edge.id, {
			points,
			label:
				label?.x !== undefined && label.y !== undefined
					? shift({
							x: label.x + (label.width ?? 0) / 2,
							y: label.y + (label.height ?? 0) / 2,
						})
					: undefined,
		});
	}

	// Where each handle landed, to check the routes against.
	const handleAt = new Map<string, Point>();
	for (const node of graph.nodes) {
		const box = boxes.get(node.id);
		if (!box) continue;
		for (const port of node.ports) {
			handleAt.set(port.id, { x: box.x + port.x, y: box.y + port.y });
		}
	}
	const meets = (point: Point | undefined, handle: Point | undefined) =>
		!point ||
		!handle ||
		(Math.abs(point.x - handle.x) <= 1 && Math.abs(point.y - handle.y) <= 1);
	const handle = (port: string | undefined) =>
		port === undefined ? undefined : handleAt.get(port);

	const routes = new Map<string, EdgeRoute>();
	for (const edge of graph.edges) {
		const found = (joins.get(edge.id) ?? []).map((part) => parts.get(part));
		if (found.length === 0 || found.some((part) => part === undefined)) {
			continue;
		}
		const lines = found.map((part) => part?.points ?? []);
		// ELK's wrapping can leave a loop's route short of its handles. A
		// plain step path draws such an edge better.
		const whole =
			meets(lines[0]?.[0], handle(edge.sourcePort)) &&
			meets(lines.at(-1)?.at(-1), handle(edge.targetPort)) &&
			lines.slice(1).every((line, i) => meets(line[0], lines[i]?.at(-1)));
		if (!whole) continue;
		routes.set(edge.id, {
			points: tidy(lines.flat()),
			label: parts.get(edge.id)?.label,
		});
	}
	return { boxes, routes };
}
