import {
	addCalledNode,
	addNode,
	addNodeAfter,
	type Flow,
	type FlowNode,
	NEW_NODE_TAKES,
	type NodeDefaults,
	type Position,
	type ProjectFlowMap,
	updateNode,
	type ValuePresetName,
	type ValuePresetResult,
} from "@nightshift/flows";
import { useReactFlow } from "@xyflow/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PaletteItem } from "../../canvas";
import { freeSpot, useNewNodeSpot } from "../../canvas";
import type { EditingSession } from "../session";
import { useEditingSession } from "../session";
import { CATALOG, type CatalogAdd, type CatalogEntry } from "./catalog";
import { opensAddNode, trackFocusInput } from "./open-keys";
import { useRecentNodes } from "./recent-nodes";
import { useMyKits } from "./use-my-kits";

/** What picking a kit, or a flow of "My kits", adds. */
type KitAdd = Extract<CatalogAdd, { kind: "kit" }>;

/** A node's width before React Flow measures it (`w-56`). */
const NODE_WIDTH = 224;
/** The space between a node and the one placed after it. */
const AFTER_GAP = 96;

type Point = { x: number; y: number };

/**
 * How the editor adds nodes: the node grid, the recent nodes of the dock,
 * and a drop on the canvas. Tab, a double-click on the canvas and the
 * dock's first button open the grid. A Value preset shows its form in the
 * grid. A picked node that takes a value goes after the one node selected
 * and reads it (`addNodeAfter`). Every other node lands where the canvas
 * was double-clicked, or in the middle of the view. A dropped node, kit or
 * preset lands where it was dropped. A kit, or a flow of "My kits", goes
 * in as a Subflow that runs it. A flow of another project is copied here
 * first. Each add is one step of the session, joins the open Section and
 * selects the new node. While `disabled` (a proposal, a revision or a
 * Subflow on view), nothing opens the grid and nothing is added.
 */
export function useNodeAdder({
	session,
	projectId,
	flowName,
	flows,
	defaults,
	disabled,
	canCopyKits,
}: {
	session: EditingSession;
	projectId: string;
	/** The flow open in the editor. */
	flowName: string;
	/** The project's other flows. Undefined while they load. */
	flows: ProjectFlowMap | undefined;
	defaults: NodeDefaults | undefined;
	disabled: boolean;
	/** False for a Space viewer: My kits show this project only. */
	canCopyKits: boolean;
}) {
	const { draft: flow, selection } = useEditingSession(session);
	const [open, setOpen] = useState(false);
	// The Value preset whose form the grid shows, if one.
	const [preset, setPreset] = useState<ValuePresetName | null>(null);
	// The point on the screen the canvas was double-clicked or dropped at, if it was.
	const anchor = useRef<Point | undefined>(undefined);
	const spot = useNewNodeSpot();
	const { getInternalNode } = useReactFlow();
	const myKits = useMyKits({
		projectId,
		flowName,
		flows,
		draft: flow,
		open,
		canCopy: canCopyKits,
	});
	const recent = useRecentNodes();

	const show = useCallback(
		(at?: Point) => {
			if (disabled) return;
			anchor.current = at;
			setOpen(true);
		},
		[disabled],
	);

	const close = useCallback(() => {
		setOpen(false);
		setPreset(null);
		anchor.current = undefined;
	}, []);

	// A proposal, a revision or a Subflow that comes on view shuts it.
	useEffect(() => {
		if (disabled) close();
	}, [disabled, close]);

	// Tab opens it, where Tab has no other job (`opensAddNode`).
	const disabledRef = useRef(disabled);
	disabledRef.current = disabled;
	useEffect(() => {
		const focus = trackFocusInput(window);
		const onKeyDown = (event: KeyboardEvent) => {
			if (disabledRef.current) return;
			if (!opensAddNode(event, focus.history(), document.body)) return;
			event.preventDefault();
			focus.keep();
			anchor.current = undefined;
			setOpen(true);
		};
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
			focus.stop();
		};
	}, []);

	const from =
		selection?.kind === "node"
			? (flow.nodes.find((node) => node.id === selection.id) ?? null)
			: null;

	/** Right of `node`, level with it. */
	const after = (node: FlowNode): Position => {
		const width = getInternalNode(node.id)?.measured.width ?? NODE_WIDTH;
		return freeSpot(flow, {
			x: node.position.x + width + AFTER_GAP,
			y: node.position.y,
		});
	};

	const place = (item: PaletteItem) =>
		from && NEW_NODE_TAKES[item] === "value"
			? addNodeAfter(flow, item, from.id, after(from), defaults)
			: addNode(flow, item, spot(flow, anchor.current), defaults);

	const commit = ({ flow: next, id }: { flow: Flow; id: string }) => {
		session.add(next);
		session.select({ kind: "node", id });
	};

	/** A Subflow that runs the kit or the flow, placed as a node that takes nothing. */
	const addKit = async ({ flow: called, from: project }: KitAdd) => {
		const at = anchor.current;
		const name = project ? await myKits.copyHere(called, project) : called;
		if (name === null) return;
		// The draft as it is now: a copy into the project takes a moment.
		const now = session.get().draft;
		commit(addCalledNode(now, name, spot(now, at)));
	};

	/** Adds a picked entry. A preset shows its form first. */
	const pick = (entry: CatalogEntry) => {
		if (disabled) return;
		if (entry.add.kind === "preset") {
			setPreset(entry.add.preset);
			setOpen(true);
			return;
		}
		if (entry.add.kind === "kit") void addKit(entry.add);
		else {
			recent.remember(entry.add.item);
			commit(place(entry.add.item));
		}
		close();
	};

	/** Adds the entry with this key where it was dropped, at `at` on the screen. */
	const drop = (key: string, at: Point) => {
		if (disabled) return;
		const entry = [...CATALOG, ...myKits.entries].find(
			(candidate) => candidate.key === key,
		);
		if (!entry) return;
		anchor.current = at;
		if (entry.add.kind === "preset") {
			// Its form opens in the grid. Use places the Value at `at`.
			setPreset(entry.add.preset);
			setOpen(true);
			return;
		}
		if (entry.add.kind === "kit") void addKit(entry.add);
		else {
			recent.remember(entry.add.item);
			const now = session.get().draft;
			commit(addNode(now, entry.add.item, spot(now, at), defaults));
		}
		anchor.current = undefined;
	};

	/** One Value by rule, with what the preset made, in one change. */
	const applyPreset = ({ expression, output }: ValuePresetResult) => {
		const added = place("value");
		recent.remember("value");
		commit({
			id: added.id,
			flow: updateNode(added.flow, added.id, (node) =>
				node.type === "value" ? { ...node, expression, output } : node,
			),
		});
		close();
	};

	return {
		open,
		/** Opens the grid, to place a node at `at` on the screen, if given. */
		show,
		close,
		flow,
		/** The one node selected: what takes a value goes after it and reads its main output. */
		from,
		/** The Value preset whose form the grid shows, and how to go back to the list. */
		preset,
		closePreset: () => setPreset(null),
		/** The flows of the Space that another flow runs (`myKitEntries`). */
		myKits: myKits.entries,
		/** The nodes added last, the newest first. */
		recent: recent.items,
		pick,
		drop,
		applyPreset,
	};
}

/** What the node dock and the grid read and call. */
export type NodeAdder = ReturnType<typeof useNodeAdder>;
