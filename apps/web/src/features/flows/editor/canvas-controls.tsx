import type { Flow, FlowNodeType } from "@nightshift/flows";
import { addNode, type NodeDefaults } from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import { ButtonGroup } from "@nightshift/ui/components/button-group";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import {
	type FitViewOptions,
	Panel,
	useReactFlow,
	useStoreApi,
} from "@xyflow/react";
import { MaximizeIcon, MinusIcon, PlusIcon, WorkflowIcon } from "lucide-react";
import { FIT_VIEW } from "./fit-view";
import type { SelectionSetter } from "./selection";

// Adding a node, and the zoom, fit and layout buttons: the parts of a flow
// canvas around its nodes and edges.

/** Below the node a new one lands on, so repeated adds do not stack exactly. */
const ADD_OFFSET = 32;

/**
 * Adds a node and selects it: where it was dropped (`at`, a point on the
 * screen), or else in the middle of the visible canvas, a third from the
 * top. Nudged past nodes already on that spot.
 */
export function useAddNode(
	flow: Flow,
	onFlowChange: (change: (flow: Flow) => Flow) => void,
	onSelect: SelectionSetter,
	defaults: NodeDefaults | undefined,
) {
	const { screenToFlowPosition } = useReactFlow();
	const store = useStoreApi();
	return (type: FlowNodeType, at?: { x: number; y: number }) => {
		const rect = store.getState().domNode?.getBoundingClientRect();
		const center = at
			? screenToFlowPosition(at)
			: rect
				? screenToFlowPosition({
						x: rect.left + rect.width / 2,
						y: rect.top + rect.height / 3,
					})
				: { x: 0, y: 0 };
		// Nudge down past nodes that already sit on that spot.
		let position = { x: Math.round(center.x - 120), y: Math.round(center.y) };
		while (
			flow.nodes.some(
				(node) =>
					Math.abs(node.position.x - position.x) < ADD_OFFSET &&
					Math.abs(node.position.y - position.y) < ADD_OFFSET,
			)
		) {
			position = { x: position.x + ADD_OFFSET, y: position.y + ADD_OFFSET };
		}
		const result = addNode(flow, type, position, defaults);
		onFlowChange(() => result.flow);
		onSelect({ kind: "node", id: result.id });
	};
}

/**
 * Zoom in, zoom out, fit and auto layout, as a vertical shadcn button group.
 * Without `onAutoLayout`, as on a read-only canvas, there is no Lay out.
 */
export function CanvasControls({
	onAutoLayout,
	fit = FIT_VIEW,
}: {
	onAutoLayout?: () => void;
	/** How Fit view fits the flow: beside a panel that covers the canvas, for example. */
	fit?: FitViewOptions;
}) {
	const { zoomIn, zoomOut, fitView } = useReactFlow();
	const controls = [
		{
			label: "Zoom in",
			icon: PlusIcon,
			onClick: () => void zoomIn({ duration: 150 }),
		},
		{
			label: "Zoom out",
			icon: MinusIcon,
			onClick: () => void zoomOut({ duration: 150 }),
		},
		{
			label: "Fit view",
			icon: MaximizeIcon,
			onClick: () => void fitView({ ...fit, duration: 200 }),
		},
		...(onAutoLayout
			? [{ label: "Auto layout", icon: WorkflowIcon, onClick: onAutoLayout }]
			: []),
	];
	return (
		<Panel position="bottom-left" className="m-3!">
			<ButtonGroup orientation="vertical" aria-label="Canvas controls">
				{controls.map(({ label, icon: Icon, onClick }) => (
					<Tooltip key={label}>
						<TooltipTrigger
							render={
								<Button
									variant="outline"
									size="icon-sm"
									className="bg-background dark:bg-background"
									aria-label={label}
									onClick={onClick}
								/>
							}
						>
							<Icon />
						</TooltipTrigger>
						<TooltipContent side="right">{label}</TooltipContent>
					</Tooltip>
				))}
			</ButtonGroup>
		</Panel>
	);
}
