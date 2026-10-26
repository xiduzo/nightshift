// An open Section: the canvas shows only what is inside it, as if you
// stepped inside. Its nodes show, and the Sections inside it as boxes.
// Zoom far into a box and it opens. Zoom far out of an open Section and
// you are one level up, on the Section around it or the whole flow. Like a
// network inside a component in TouchDesigner, but the flow file does not
// change: only the view does.

import {
	type Flow,
	type FlowSection,
	parentSection,
	sectionLevel,
	sectionPath,
} from "@nightshift/flows";
import { useMemo } from "react";

/**
 * The open Section of `flow`, the Sections around it (outermost first,
 * ending with it), and what the canvas shows: one level of the nesting
 * (`sectionLevel`). The whole flow when no Section is open or the open
 * one is gone.
 */
export function useOpenSection(flow: Flow, openId: string | null) {
	return useMemo(() => {
		const path = openId ? sectionPath(flow, openId) : [];
		const section: FlowSection | null = path.at(-1) ?? null;
		return {
			section,
			path,
			/** The level one step out: the Section around it, or null for the whole flow. */
			up: section ? (parentSection(flow, section.id)?.id ?? null) : null,
			view: sectionLevel(flow, section?.id ?? null),
		};
	}, [flow, openId]);
}

type Size = { width: number; height: number };

/**
 * A box this big on screen, in either direction, opens on the next zoom
 * in: it almost fills the canvas.
 */
const OPEN_SHARE = 0.9;
/**
 * Zoomed out below this share of the zoom that fits the open Section, it
 * closes. Far enough from `OPEN_SHARE` that a box that just closed does
 * not open again on the next step in, and the other way round.
 */
const CLOSE_SHARE = 0.4;
/**
 * How big a box shows after it closes: big, but far enough below
 * `OPEN_SHARE` that the next step in does not open it again.
 */
const CLOSED_SHARE = 0.55;
/** The room a fit leaves around the nodes. */
const FIT_ROOM = 0.85;

/**
 * Whether one more step of zooming in on a box opens it: the box fills
 * most of the canvas, or the canvas cannot zoom in further.
 */
export function opensOnZoomIn({
	box,
	canvas,
	zoom,
	maxZoom,
}: {
	box: Size;
	canvas: Size;
	zoom: number;
	maxZoom: number;
}): boolean {
	if (zoom >= maxZoom * 0.99) return true;
	return (
		box.width * zoom >= canvas.width * OPEN_SHARE ||
		box.height * zoom >= canvas.height * OPEN_SHARE
	);
}

/**
 * Whether one more step of zooming out of an open Section closes it: the
 * nodes show much smaller than a fit shows them, or the canvas cannot
 * zoom out further.
 */
export function closesOnZoomOut({
	content,
	canvas,
	zoom,
	minZoom,
	fitMaxZoom = 1,
}: {
	content: Size;
	canvas: Size;
	zoom: number;
	minZoom: number;
	fitMaxZoom?: number;
}): boolean {
	if (zoom <= minZoom * 1.01) return true;
	const fit = Math.min(
		fitMaxZoom,
		(canvas.width * FIT_ROOM) / Math.max(content.width, 1),
		(canvas.height * FIT_ROOM) / Math.max(content.height, 1),
	);
	return zoom <= fit * CLOSE_SHARE;
}

/**
 * The zoom that shows a Section's box at about half the canvas after it
 * closes: you stay close to it, but zooming in does not open it again at
 * once.
 */
export function zoomAfterClose({
	box,
	canvas,
	minZoom,
	maxZoom,
}: {
	box: Size;
	canvas: Size;
	minZoom: number;
	maxZoom: number;
}): number {
	const zoom = Math.min(
		(canvas.width * CLOSED_SHARE) / Math.max(box.width, 1),
		(canvas.height * CLOSED_SHARE) / Math.max(box.height, 1),
		// Below the zoom at which every box opens.
		maxZoom * 0.8,
	);
	return Math.max(zoom, minZoom);
}

export type Rect = { x: number; y: number; width: number; height: number };
export type Transform = { x: number; y: number; zoom: number };

/**
 * The view that shows `to` (in flow coordinates) where `from` shows now,
 * as big as fits inside it, centred. So a Section's nodes take the place
 * of its box, and the box the place of its nodes.
 */
export function handOver(from: Rect, to: Rect, now: Transform): Transform {
	const width = from.width * now.zoom;
	const height = from.height * now.zoom;
	const zoom = Math.min(
		width / Math.max(to.width, 1),
		height / Math.max(to.height, 1),
	);
	const centre = {
		x: (from.x + from.width / 2) * now.zoom + now.x,
		y: (from.y + from.height / 2) * now.zoom + now.y,
	};
	return {
		x: centre.x - (to.x + to.width / 2) * zoom,
		y: centre.y - (to.y + to.height / 2) * zoom,
		zoom,
	};
}
