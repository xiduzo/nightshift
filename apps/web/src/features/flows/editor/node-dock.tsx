import type { FlowNodeType } from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { cn } from "@nightshift/ui/lib/utils";
import { NODE_TYPE } from "../canvas/node-type";

/** In four groups: do, decide, shape, wait, compose (docs/research/foundational-nodes.md §5). */
const PALETTE: FlowNodeType[] = [
	"agent",
	"command",
	"tool",
	"decision",
	"value",
	"wait",
	"call",
];

/** The drag data of a node type on its way from the dock to the canvas. */
export const NODE_DRAG_TYPE = "application/x-nightshift-node";

export function isNodeType(value: string): value is FlowNodeType {
	return (PALETTE as string[]).includes(value);
}

/**
 * One dock item, after the Magic UI Dock, in CSS only: the item you point at
 * grows most, its neighbours a little, the next ones a touch. The dock keeps
 * its width, so the bigger icons reach out over the canvas.
 */
const DOCK_ITEM = cn(
	"size-10 shrink-0 cursor-grab rounded-full bg-background p-0 active:cursor-grabbing dark:bg-background",
	"transition-[width,height] duration-200 ease-out motion-reduce:transition-none",
	"hover:size-15",
	"[&:has(+_*:hover)]:size-[50px] [*:hover+&]:size-[50px]",
	"[&:has(+*+*:hover)]:size-11 [*:hover+*+&]:size-11",
);

/**
 * The node types, as a dock on the left edge of the canvas. Drag one onto
 * the canvas to place it, or click it to add it in the middle.
 */
export function NodeDock({
	onAdd,
	onDragChange,
	className,
}: {
	onAdd: (type: FlowNodeType) => void;
	/** The type being dragged, and null when the drag ends. */
	onDragChange: (type: FlowNodeType | null) => void;
	className?: string;
}) {
	return (
		<div
			role="toolbar"
			aria-label="Add a node"
			aria-orientation="vertical"
			className={cn(
				"flex w-[58px] flex-col items-start gap-2 rounded-2xl border bg-background/80 p-2 shadow-sm backdrop-blur-md",
				className,
			)}
		>
			{PALETTE.map((type) => {
				const { label, icon: Icon, blurb } = NODE_TYPE[type];
				return (
					<Tooltip key={type}>
						<TooltipTrigger
							render={
								<Button
									variant="outline"
									draggable
									onDragStart={(event) => {
										event.dataTransfer.setData(NODE_DRAG_TYPE, type);
										event.dataTransfer.effectAllowed = "move";
										onDragChange(type);
									}}
									onDragEnd={() => onDragChange(null)}
									onClick={() => onAdd(type)}
									className={DOCK_ITEM}
									aria-label={label}
								/>
							}
						>
							<Icon className="size-[45%]" aria-hidden="true" />
						</TooltipTrigger>
						<TooltipContent side="right" className="max-w-60">
							<span className="flex flex-col gap-0.5">
								<span className="font-medium">{label}</span>
								<span className="opacity-80">{blurb}</span>
							</span>
						</TooltipContent>
					</Tooltip>
				);
			})}
		</div>
	);
}
