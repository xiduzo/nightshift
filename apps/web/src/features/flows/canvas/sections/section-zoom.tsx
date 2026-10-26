// Opening and closing a Section on the canvas by zooming, and the bar that
// shows which Section is open. Put `SectionZoom` inside `<ReactFlow>`: it
// reads the canvas's zoom and nodes from React Flow.

import {
	type Flow,
	type FlowSection,
	nodesWithin,
	sectionPath,
} from "@nightshift/flows";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@nightshift/ui/components/breadcrumb";
import { Button } from "@nightshift/ui/components/button";
import { Card } from "@nightshift/ui/components/card";
import { Kbd } from "@nightshift/ui/components/kbd";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { cn } from "@nightshift/ui/lib/utils";
import {
	type FitViewOptions,
	Panel,
	useReactFlow,
	useStoreApi,
} from "@xyflow/react";
import { ArrowUpIcon, GroupIcon } from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useRef } from "react";
import { readSubflowKey } from "../../editor/subflow/use-subflow-stack";
import type { Measured } from "../use-measured";
import {
	closesOnZoomOut,
	handOver,
	opensOnZoomIn,
	type Rect,
	type Transform,
	zoomAfterClose,
} from "./section-focus";
import { membersBounds } from "./section-geometry";
import { sectionIdOf, sectionNodeId } from "./section-ids";

/** How long the canvas takes to settle after you open or close a Section with a button or a key. */
const MOVE_MS = 250;
/**
 * After a zoom closes a Section, the wheel does nothing until it is still
 * this long: the rest of the gesture (a trackpad glides on) does not zoom
 * the whole flow out past the box you just left.
 */
const QUIET_MS = 200;
/** A box React Flow has not measured: `w-64`, a few rows. */
const BOX_FALLBACK = { width: 256, height: 160 };

/**
 * Zoom far into a box and its Section opens: its nodes take the box's
 * place, at the box's size, and the zoom goes on inside. Zoom far out of
 * the open Section and you go up one level: the box takes the place of its
 * nodes, and the zoom goes on outside. `u` goes up too. Opened or closed
 * with a button or a key, the view then settles on the nodes, or on the box.
 */
export function SectionZoom({
	flow,
	measured,
	open,
	onOpen,
	onClose,
	fit,
}: {
	/** The whole flow, also while a Section is open. */
	flow: Flow;
	/** The sizes React Flow measured, by canvas id. */
	measured: Measured;
	/** The id of the open Section, or null on the whole flow. */
	open: string | null;
	onOpen: (sectionId: string) => void;
	/** Up one level: to the Section around the open one, or the whole flow. */
	onClose: () => void;
	/** How a fit shows the open Section's nodes. */
	fit: FitViewOptions;
}) {
	const store = useStoreApi();
	const { fitView, setCenter, setViewport } = useReactFlow();

	// The latest props, for the listeners.
	const latest = useRef({ flow, measured, open, onOpen, onClose, fit });
	latest.current = { flow, measured, open, onOpen, onClose, fit };

	// Set by a zoom that opens or closes: the zoom goes on, nothing settles.
	const byZoom = useRef(false);
	// Between an opening or a closing and the view that hands over.
	const moving = useRef(false);

	useEffect(() => {
		const domNode = store.getState().domNode;
		if (!domNode) return;
		// Holds the wheel until it is still, after a zoom closed a Section.
		let quiet: ReturnType<typeof setTimeout> | undefined;
		let holding = false;
		const hold = (event: WheelEvent) => {
			event.preventDefault();
			event.stopPropagation();
			holding = true;
			clearTimeout(quiet);
			quiet = setTimeout(() => {
				holding = false;
			}, QUIET_MS);
		};
		const onWheel = (event: WheelEvent) => {
			if (holding) {
				hold(event);
				return;
			}
			if (moving.current || event.deltaY === 0) return;
			const state = store.getState();
			const [x, y, zoom] = state.transform;
			const canvas = { width: state.width, height: state.height };
			const { open, onOpen, onClose, fit } = latest.current;

			if (event.deltaY < 0) {
				const rect = domNode.getBoundingClientRect();
				const at = {
					x: (event.clientX - rect.left - x) / zoom,
					y: (event.clientY - rect.top - y) / zoom,
				};
				for (const node of state.nodeLookup.values()) {
					if (node.type !== "sectionBox") continue;
					const sectionId = sectionIdOf(node.id);
					const { x: left, y: top } = node.internals.positionAbsolute;
					const box = {
						width: node.measured.width ?? BOX_FALLBACK.width,
						height: node.measured.height ?? BOX_FALLBACK.height,
					};
					const under =
						at.x >= left &&
						at.x <= left + box.width &&
						at.y >= top &&
						at.y <= top + box.height;
					if (sectionId === undefined || !under) continue;
					if (!opensOnZoomIn({ box, canvas, zoom, maxZoom: state.maxZoom }))
						return;
					byZoom.current = true;
					onOpen(sectionId);
					return;
				}
				return;
			}

			if (event.deltaY > 0 && open !== null) {
				const content = nodesBounds(store.getState().nodeLookup.values());
				if (!content) return;
				if (
					!closesOnZoomOut({
						content,
						canvas,
						zoom,
						minZoom: state.minZoom,
						fitMaxZoom: fit.maxZoom,
					})
				)
					return;
				byZoom.current = true;
				hold(event);
				onClose();
			}
		};
		// Capture, before React Flow zooms on the same event: so it can hold
		// the wheel. Else React Flow zooms on it as usual.
		domNode.addEventListener("wheel", onWheel, {
			capture: true,
			passive: false,
		});
		return () => {
			clearTimeout(quiet);
			domNode.removeEventListener("wheel", onWheel, { capture: true });
		};
	}, [store]);

	// `u` closes the open Section, before a Subflow seen in place goes up
	// (capture). Not while the canvas is out of use, as under a Subflow seen
	// in place.
	useEffect(() => {
		if (open === null) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (readSubflowKey(event) !== "up" || event.key === "Escape") return;
			if (store.getState().domNode?.closest("[inert]")) return;
			event.preventDefault();
			latest.current.onClose();
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [open, store]);

	// Opened or closed: hide the nodes until React Flow has measured the new
	// ones, then hand the view over from the box to the nodes, or back.
	const before = useRef(open);
	useLayoutEffect(() => {
		const closed = before.current;
		before.current = open;
		if (closed === open) return;
		// The box that hands over: the Section one level inside the outer of
		// the two views, on the way to the inner one. None for a jump to a
		// Section that is not inside or around the one before.
		const pathOf = (id: string | null) =>
			id === null
				? []
				: sectionPath(latest.current.flow, id).map((section) => section.id);
		const from = pathOf(closed);
		const to = pathOf(open);
		const startsWith = (path: string[], head: string[]) =>
			head.every((id, index) => path[index] === id);
		const opening = startsWith(to, from);
		const sectionId = opening
			? to[from.length]
			: startsWith(from, to)
				? from[to.length]
				: undefined;
		const viewportEl = store
			.getState()
			.domNode?.querySelector<HTMLElement>(".react-flow__viewport");
		const show = () => {
			if (viewportEl) viewportEl.style.opacity = "";
			moving.current = false;
		};
		if (viewportEl) viewportEl.style.opacity = "0";
		moving.current = true;
		const settle = !byZoom.current;
		byZoom.current = false;

		let frame = 0;
		let tries = 0;
		const move = () => {
			const state = store.getState();
			const nodes = [...state.nodeLookup.values()];
			const ready = nodes.every((node) => node.measured.width !== undefined);
			if (!ready && tries++ < 20) {
				frame = requestAnimationFrame(move);
				return;
			}
			const { flow, measured, fit } = latest.current;
			const section = flow.sections?.find((each) => each.id === sectionId);
			const members = section
				? membersBounds(flow, nodesWithin(flow, section), measured)
				: null;
			const [x, y, zoom] = state.transform;
			const now = { x, y, zoom };
			const boxSize = (id: string) => {
				const node = state.nodeLookup.get(sectionNodeId(id));
				return {
					width:
						node?.measured.width ??
						measured[sectionNodeId(id)]?.width ??
						BOX_FALLBACK.width,
					height:
						node?.measured.height ??
						measured[sectionNodeId(id)]?.height ??
						BOX_FALLBACK.height,
				};
			};
			if (!sectionId || !members) {
				show();
				void fitView({ ...fit, duration: MOVE_MS });
				return;
			}
			const box = { x: members.x, y: members.y, ...boxSize(sectionId) };
			if (opening) {
				// The nodes as measured now, in place of the box.
				const content = nodesBounds(nodes) ?? members;
				void setViewport(clamp(handOver(box, content, now), state));
				show();
				if (settle) void fitView({ ...fit, duration: MOVE_MS });
				return;
			}
			// The box in place of the nodes, big enough to find again.
			const canvas = { width: state.width, height: state.height };
			if (!settle) {
				const view = handOver(members, box, now);
				const zoom = Math.max(
					view.zoom,
					zoomAfterClose({
						box,
						canvas,
						minZoom: state.minZoom,
						maxZoom: state.maxZoom,
					}),
				);
				void setViewport(clamp(scaleAround(view, box, zoom), state));
				show();
				return;
			}
			void setViewport(clamp(handOver(members, box, now), state));
			show();
			void setCenter(box.x + box.width / 2, box.y + box.height / 2, {
				zoom: zoomAfterClose({
					box,
					canvas,
					minZoom: state.minZoom,
					maxZoom: state.maxZoom,
				}),
				duration: MOVE_MS,
			});
		};
		frame = requestAnimationFrame(move);
		return () => {
			cancelAnimationFrame(frame);
			show();
		};
	}, [open, store, fitView, setCenter, setViewport]);

	return null;
}

/** The box around the nodes, by where React Flow has them. */
function nodesBounds(
	nodes: Iterable<{
		internals: { positionAbsolute: { x: number; y: number } };
		measured: { width?: number; height?: number };
	}>,
): Rect | null {
	let left = Number.POSITIVE_INFINITY;
	let top = Number.POSITIVE_INFINITY;
	let right = Number.NEGATIVE_INFINITY;
	let bottom = Number.NEGATIVE_INFINITY;
	for (const node of nodes) {
		const { x, y } = node.internals.positionAbsolute;
		left = Math.min(left, x);
		top = Math.min(top, y);
		right = Math.max(right, x + (node.measured.width ?? 0));
		bottom = Math.max(bottom, y + (node.measured.height ?? 0));
	}
	if (left === Number.POSITIVE_INFINITY) return null;
	return { x: left, y: top, width: right - left, height: bottom - top };
}

/** `view` at `zoom`, with the middle of `rect` where it shows now. */
function scaleAround(view: Transform, rect: Rect, zoom: number): Transform {
	const middle = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
	return {
		x: middle.x * view.zoom + view.x - middle.x * zoom,
		y: middle.y * view.zoom + view.y - middle.y * zoom,
		zoom,
	};
}

/** Within the zoom the canvas allows, around the middle of the canvas. */
function clamp(
	view: Transform,
	{
		minZoom,
		maxZoom,
		width,
		height,
	}: { minZoom: number; maxZoom: number; width: number; height: number },
): Transform {
	if (view.zoom >= minZoom && view.zoom <= maxZoom) return view;
	const zoom = Math.min(Math.max(view.zoom, minZoom), maxZoom);
	const middle = {
		x: (width / 2 - view.x) / view.zoom,
		y: (height / 2 - view.y) / view.zoom,
	};
	return {
		x: width / 2 - middle.x * zoom,
		y: height / 2 - middle.y * zoom,
		zoom,
	};
}

/**
 * Over the canvas while a Section is open: where you are, with a link to
 * each level around it, and the way up one level.
 */
export function OpenSectionBar({
	path,
	flowLabel,
	onOpen,
}: {
	/** The open Section and the Sections around it, outermost first. */
	path: readonly FlowSection[];
	/** What the whole flow is called in the breadcrumb, such as its name. */
	flowLabel: string;
	/** Shows that Section, or the whole flow for null. */
	onOpen: (sectionId: string | null) => void;
}) {
	const open = path.at(-1);
	if (!open) return null;
	const around = path.slice(0, -1);
	const up = around.at(-1)?.id ?? null;
	const link = (label: string, id: string | null, mono = false) => (
		<BreadcrumbLink
			render={
				<button
					type="button"
					className={cn(
						"truncate rounded-sm font-normal outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
						mono && "font-mono",
					)}
					onClick={() => onOpen(id)}
				/>
			}
		>
			{label}
		</BreadcrumbLink>
	);
	return (
		<Panel position="bottom-center" className="m-3! max-w-[calc(100%-1.5rem)]">
			<Card
				size="sm"
				className="flex-row items-center gap-2 py-1.5 pr-1.5 pl-3 shadow-sm"
			>
				<Breadcrumb aria-label="Where in the flow" className="min-w-0">
					<BreadcrumbList className="flex-nowrap gap-1 text-xs sm:gap-1.5">
						<BreadcrumbItem className="shrink-0">
							{link(flowLabel, null, true)}
						</BreadcrumbItem>
						{around.map((section) => (
							<Fragment key={section.id}>
								<BreadcrumbSeparator />
								<BreadcrumbItem className="min-w-0 max-w-32">
									{link(nameOf(section), section.id)}
								</BreadcrumbItem>
							</Fragment>
						))}
						<BreadcrumbSeparator />
						<BreadcrumbItem className="min-w-0">
							<BreadcrumbPage
								aria-current="location"
								className="flex min-w-0 items-center gap-1 font-medium"
							>
								<GroupIcon className="size-3.5 shrink-0" aria-hidden="true" />
								<span className="truncate">{nameOf(open)}</span>
							</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
				<Tooltip>
					<TooltipTrigger
						render={
							<Button variant="ghost" size="xs" onClick={() => onOpen(up)} />
						}
					>
						<ArrowUpIcon data-icon="inline-start" />
						Go up
					</TooltipTrigger>
					<TooltipContent side="top">
						{up === null
							? "Back to the whole flow. Or zoom out."
							: "Back to the Section around it. Or zoom out."}
						<Kbd>U</Kbd>
					</TooltipContent>
				</Tooltip>
			</Card>
		</Panel>
	);
}

/** A Section's label, else its id. */
function nameOf(section: FlowSection): string {
	return section.label.trim() || section.id;
}
