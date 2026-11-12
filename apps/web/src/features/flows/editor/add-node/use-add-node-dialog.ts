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
	type ValuePresetResult,
} from "@nightshift/flows";
import { useReactFlow } from "@xyflow/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PaletteItem } from "../../canvas/node-type";
import { freeSpot, useNewNodeSpot } from "../canvas-controls";
import type { EditingSession } from "../session/editing-session";
import { useEditingSession } from "../session/use-editing-session";
import type { CatalogAdd } from "./catalog";
import { opensAddNode, trackFocusInput } from "./open-keys";
import { useMyKits } from "./use-my-kits";

/** What picking a kit, or a flow of "My kits", adds. */
type KitAdd = Extract<CatalogAdd, { kind: "kit" }>;

/** A node's width before React Flow measures it (`w-56`). */
const NODE_WIDTH = 224;
/** The space between a node and the one placed after it. */
const AFTER_GAP = 96;

type Point = { x: number; y: number };

/**
 * The add-node dialog of the editor: Tab, a double-click on the canvas and
 * the dock's first button open it. A node that takes a value goes after
 * the one node selected and reads it (`addNodeAfter`). Every other node
 * lands where the canvas was double-clicked, or in the middle of the view.
 * A kit, or a flow of "My kits", goes in as a Subflow that runs it. A flow
 * of another project is copied here first. Each add is one step of the
 * session, joins the open Section and selects the new node. While
 * `disabled` (a proposal, a revision or a Subflow on view), nothing opens it.
 */
export function useAddNodeDialog({
	session,
	projectId,
	flowName,
	flows,
	defaults,
	disabled,
}: {
	session: EditingSession;
	projectId: string;
	/** The flow open in the editor. */
	flowName: string;
	/** The project's other flows. Undefined while they load. */
	flows: ProjectFlowMap | undefined;
	defaults: NodeDefaults | undefined;
	disabled: boolean;
}) {
	const { draft: flow, selection } = useEditingSession(session);
	const [open, setOpen] = useState(false);
	// The point on the screen the canvas was double-clicked at, if it was.
	const anchor = useRef<Point | undefined>(undefined);
	const spot = useNewNodeSpot();
	const { getInternalNode } = useReactFlow();
	const myKits = useMyKits({ projectId, flowName, flows, draft: flow, open });

	const show = useCallback(
		(at?: Point) => {
			if (disabled) return;
			anchor.current = at;
			setOpen(true);
		},
		[disabled],
	);

	// A proposal, a revision or a Subflow that comes on view shuts it.
	useEffect(() => {
		if (disabled) setOpen(false);
	}, [disabled]);

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

	return {
		/** Opens the dialog, to place a node at `at` on the screen, if given. */
		show,
		props: {
			open,
			onOpenChange: setOpen,
			flow,
			from,
			myKits: myKits.entries,
			onAddNode: (item: PaletteItem) => commit(place(item)),
			onAddKit: (add: KitAdd) => void addKit(add),
			// One Value by rule, with what the preset made, in one change.
			onUsePreset: ({ expression, output }: ValuePresetResult) => {
				const added = place("value");
				commit({
					id: added.id,
					flow: updateNode(added.flow, added.id, (node) =>
						node.type === "value" ? { ...node, expression, output } : node,
					),
				});
			},
		},
	};
}
